const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const cron = require('node-cron');
const sendEmail = require('./utils/emailUtils');

require('dotenv').config();
require('./passport-setup');
const saltRounds = 10;
const db = require('./db');

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(passport.initialize()); // Initialize Passport middleware

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    console.error('JWT_SECRET is not defined in the environment variables');
    process.exit(1); // Exit the process if JWT_SECRET is not defined
}

// Utility functions 
const calculateTrend = (data, key) => {
    if (data.length < 2) return 0;
    const initial = data[0][key];
    const final = data[data.length - 1][key];
    return final - initial;
};

// Error Handling Middleware
app.use((err, req, res, next) => {
    console.error('Internal server error:', err);
    res.status(500).json({ error: 'An internal server error occurred' });
});

// Middleware to verify JWT token
const verifyTokenStudent = passport.authenticate('student-jwt', { session: false });
const verifyTokenStaff = passport.authenticate('staff-jwt', { session: false });

const testEmailAddress = 'amulvenna10@qub.ac.uk';


// CRON Jobs
// Schedule a job to run every day at midnight to alert student that thney have not recorded in 5 days (currently set to 1 minute)
cron.schedule('0 0 * * *', async () => {
    try {
        const checkQuery = `
            SELECT student_email, student_name
            FROM student
            WHERE student_email = ? AND student_id NOT IN (
                SELECT DISTINCT student_id 
                FROM daily_record
                WHERE daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 1 MINUTE)
            )
        `;

        db.query(checkQuery, [testEmailAddress], async (err, results) => {
            if (err) {
                console.error('Error checking students:', err);
                return;
            }

            for (const student of results) {
                const { student_email, student_name } = student;
                const emailMessage = `Dear ${student_name},\n\nIt seems like you haven't recorded any activities in the last 5 days. Please make sure to record your activities regularly.`;
                const emailHtml = `
                    <p>Dear ${student_name},</p>
                    <p>It seems like you haven't recorded any activities in the last 5 days. Please make sure to record your activities regularly.</p>
                    <p>Best regards,</p>
                    <p>The Student Pulse Team</p>
                `;
                sendEmail(student_email, 'Activity Reminder', emailMessage, emailHtml);
            }
        });
    } catch (error) {
        console.error('Error running scheduled job:', error);
    }
});

cron.schedule('0 0 * * *', async () => {
    try {
        const checkQuery = `
            SELECT s.student_email, s.student_name, s.student_id, st.staff_email
            FROM student s
            JOIN staff st
            WHERE s.student_id NOT IN (
                SELECT DISTINCT student_id 
                FROM daily_record
                WHERE daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
            )
            AND s.student_id NOT IN (
                SELECT DISTINCT student_id 
                FROM quick_track
                WHERE quick_track_timestamp >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
            )
        `;

        db.query(checkQuery, async (err, results) => {
            if (err) {
                console.error('Error checking students:', err);
                return;
            }

            for (const record of results) {
                const { student_email, student_name, student_id, staff_email } = record;
                const emailMessage = `Dear Staff,\n\nStudent ${student_name} has not recorded any activities in the last 14 days. Please follow up with them.\n\nBest regards,\nYour Wellness App Team`;
                const emailHtml = `
                    <p>Dear Staff,</p>
                    <p>Student ${student_name} has not recorded any activities in the last 14 days. Please follow up with them.</p>
                    <p><a href="${process.env.FRONTEND_URL}/write-email/${student_id}" style="display: inline-block; padding: 10px 20px; font-size: 16px; color: white; background-color: blue; text-decoration: none; border-radius: 5px;">Write Email</a></p>
                    <p>Best regards,</p>
                    <p>Your Wellness App Team</p>
                `;
                sendEmail(staff_email, 'Student Activity Alert', emailMessage, emailHtml);
            }
        });
    } catch (error) {
        console.error('Error running scheduled job:', error);
    }
});

// Routes

app.use('/api/quick-track', verifyTokenStudent);

app.get('/api/course-names', (req, res) => {
    const query = 'SELECT * FROM course';
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching course names:', err);
            res.status(500).json({ error: 'Failed to fetch course names' });
            return;
        }
        res.json(results);
    });
});

app.get('/api/course-years', (req, res) => {
    const query = 'SELECT * FROM academic_year';
    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching course years:', err);
            res.status(500).json({ error: 'Failed to fetch course years' });
            return;
        }
        res.json(results);
    });
});

// Route to add a new student (accessible without authentication)
app.post('/api/create-student', async (req, res) => {
    const {
        student_number,
        student_name,
        date_of_birth,
        student_email,
        course_name,
        academic_year,
        student_password
    } = req.body;

    if (!student_email.endsWith('@qub.ac.uk')) {
        res.status(400).json({ message: 'Please use your QUB email address.' });
        return;
    }

    // Query to check if student_number or student_email already exists
    const checkDuplicateQuery = `
        SELECT * FROM student
        WHERE student_number = ?
    `;
    db.query(checkDuplicateQuery, [student_number], (err, results) => {
        if (err) {
            console.error('Error checking duplicates:', err);
            res.status(500).json({ message: 'Error occurred while checking duplicates' });
            return;
        }

        if (results.length > 0) {
            // Found existing student with same student_number or student_email
            res.status(409).json({ message: 'Student numberalready exists' });
            return;
        }

        bcrypt.hash(student_password, saltRounds, (err, hashedPassword) => {
            if (err) {
                console.error('Error hashing password', err);
                res.status(500).json({ message: 'Failed to hash password' });
                return;
            }

            // Step 1: Retrieve course_id based on course_name
            const getCourseIdQuery = `SELECT course_id FROM course WHERE course_name = ?`;
            db.query(getCourseIdQuery, [course_name], async (err, courseResult) => {
                if (err) {
                    console.error('Error fetching course ID:', err);
                    res.status(500).json({ message: 'Failed to add student' });
                    return;
                }

                if (courseResult.length === 0) {
                    res.status(404).json({ message: 'Course not found' });
                    return;
                }

                const course_id = courseResult[0].course_id;

                // Step 2: Retrieve year_id based on academic_year
                const getYearIdQuery = `SELECT academic_year_id FROM academic_year WHERE academic_year_name = ?`;
                db.query(getYearIdQuery, [academic_year], async (err, yearResult) => {
                    if (err) {
                        console.error('Error fetching year ID:', err);
                        res.status(500).json({ message: 'Failed to add student/ fetch the year id' });
                        return;
                    }

                    if (yearResult.length === 0) {
                        res.status(404).json({ message: 'Academic year not found' });
                        return;
                    }

                    const year_id = yearResult[0].academic_year_id;

                    // Step 3: Insert the student into the database
                    const insertQuery = `
                INSERT INTO student (student_number, student_name, date_of_birth, student_email, course_id, course_year_id, student_password) 
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `;
                    db.query(insertQuery, [student_number, student_name, date_of_birth, student_email, course_id, year_id, hashedPassword], (err, result) => {
                        if (err) {
                            console.error('Error inserting student:', err);
                            res.status(500).json({ message: 'Failed to add student' });
                            return;
                        }

                        const student_id = result.insertId;
                        const initialStreakQuery = `
                            INSERT INTO streak (streak_value, student_id, last_record_time) 
                            VALUES (0, ?, NOW())
                        `;
                        db.query(initialStreakQuery, [student_id], (err) => {
                            if (err) {
                                console.error('Error inserting initial streak:', err);
                                res.status(500).json({ message: 'Failed to create initial streak' });
                                return;
                            }
                            const emailMessage = `Hello ${student_name},\n\nYour account has been successfully created. Welcome!`;
                            const loginLink = `${process.env.FRONTEND_URL}/login`; // Link to the login page
                            const emailHtml = `
                                <p>Hello ${student_name},</p>
                                <p>Your account has been successfully created. Welcome to our platform! Click the button below to log in:</p>
                                <a href="${loginLink}" style="display: inline-block; padding: 10px 20px; font-size: 16px; color: white; background-color: blue; text-decoration: none; border-radius: 5px;">Log In</a>
                                <p>If you did not request this, please contact our support team.</p>
                            `;

                            sendEmail(student_email, 'Account Created Successfully', emailMessage, emailHtml);

                            res.json({ message: 'Account and initial streak created successfully', student_id });
                        });
                    });
                });
            });
        });
    });
});

app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;

    const userQuery = 'SELECT * FROM student WHERE student_email = ?';
    db.query(userQuery, [email], async (err, results) => {
        if (err) {
            console.error('Error fetching user:', err);
            return res.status(500).json({ message: 'Error occurred while fetching user' });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'No account found with that email' });
        }

        const user = results[0];
        const token = jwt.sign({ id: user.student_id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        const resetLink = `${process.env.FRONTEND_URL}/reset-password/${token}`;
        const emailMessage = `Click the following link to reset your password: ${resetLink}`;
        const emailHtml = `       
        <p>Hi ${user.student_name},</p>
            <p>You requested a password reset. Click the button below to reset your password:</p>
            <a href="${resetLink}" style="display: inline-block; padding: 10px 20px; font-size: 16px; color: white; background-color: blue; text-decoration: none; border-radius: 5px;">Reset Password</a>
            <p>If you did not request this, please ignore this email.</p>
            `;
        sendEmail(email, 'Password Reset Request', emailMessage, emailHtml);


        res.json({ token });
    });
});

app.post('/api/reset-password', async (req, res) => {
    const { token, password } = req.body;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const hashedPassword = await bcrypt.hash(password, 10);

        const updateQuery = 'UPDATE student SET student_password = ? WHERE student_id = ?';
        db.query(updateQuery, [hashedPassword, decoded.id], (err, result) => {
            if (err) {
                console.error('Error updating password:', err);
                return res.status(500).json({ message: 'Failed to reset password' });
            }

            res.json({ message: 'Password reset successfully' });
        });
    } catch (err) {
        console.error('Invalid or expired token:', err);
        res.status(400).json({ message: 'Invalid or expired token' });
    }
});



app.post('/api/login/student', (req, res, next) => {
    passport.authenticate('student-local', { session: false }, (err, student, info) => {
        if (err) {
            return next(err);
        }
        if (!student) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        req.login(student, { session: false }, async (err) => {
            if (err) {
                return next(err);
            }

            const token = jwt.sign({ id: student.student_id }, JWT_SECRET, { expiresIn: '1h' });
            return res.json({ token });
        });
    })(req, res, next);
});

app.post('/api/login/staff', (req, res, next) => {
    passport.authenticate('staff-local', { session: false }, (err, staff, info) => {
        if (err) {
            return next(err);
        }
        if (!staff) {
            return res.status(401).json({ message: 'Invalid credentials' });
        }

        req.login(staff, { session: false }, async (err) => {
            if (err) {
                return next(err);
            }

            const token = jwt.sign({ id: staff.staff_id }, JWT_SECRET, { expiresIn: '1h' });
            return res.json({ token });
        });
    })(req, res, next);
});



app.get('/', (req, res) => {
    console.log('recieved a get request');
    res.send('hello world');
});

app.get('/api/mood', (req, res) => {
    const query = `SELECT * FROM moods`;
    db.query(query, function (err, rows, fields) {
        if (err) {
            console.error('Error fetching moods:', err);
            res.status(500).send('Failed to fetch moods');
            return;
        }
        if (rows.length === 0) {
            res.status(404).send('No moods found');
            return;
        }
        res.send(rows);
    })
})

app.get('/api/socialisations', (req, res) => {
    const query = `SELECT * FROM socialisation`;
    db.query(query, function (err, rows, fields) {
        if (err) {
            console.error('Error fetching socialisations:', err);
            res.status(500).send('Failed to fetch socialisations');
            return;
        }
        if (rows.length === 0) {
            res.status(404).send('No socialisations found');
            return;
        }
        res.send(rows);
    })
})
app.get('/api/exercises', (req, res) => {
    const query = `SELECT * FROM exercise`;
    db.query(query, (err, rows) => {
        if (err) {
            console.error('Error fetching exercises:', err);
            res.status(500).send('Failed to fetch exercises');
            return;
        }
        if (rows.length === 0) {
            res.status(404).send('No exercises found');
            return;
        }
        res.send(rows);
    });
});

app.get('/api/sleeps', (req, res) => {
    const query = `SELECT * FROM sleep`;
    db.query(query, (err, rows) => {
        if (err) {
            console.error('Error fetching sleeps:', err);
            res.status(500).send('Failed to fetch sleeps');
            return;
        }
        if (rows.length === 0) {
            res.status(404).send('No sleeps found');
            return;
        }
        res.send(rows);
    });
});


app.post('/api/daily-track', verifyTokenStudent, (req, res) => {

    const { student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score } = req.body;

    if (!mood_id || !exercise_id || !sleep_id || !socialisation_id || !productivity_score) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    const today = new Date().toISOString().split('T')[0];

    const checkRecordQuery = `
        SELECT * FROM daily_record 
        WHERE student_id = ? AND DATE(daily_record_timestamp) = ?
    `;

    db.query(checkRecordQuery, [student_id, today], (err, records) => {
        if (err) {
            console.error('Error checking daily record:', err);
            return res.status(500).send('Failed to check daily record');
        }

        if (records.length > 0) {
            return res.status(409).json({ message: 'Already tracked today' });
        }

        const insertQuery = `
            INSERT INTO daily_record (student_id, mood_id,  exercise_id, sleep_id, socialisation_id, productivity_score) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(insertQuery, [student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score], (err) => {
            if (err) {
                console.error('Error inserting daily record:', err);
                return res.status(500).json({ message: 'Failed to add daily record' });
            }

            const getStreakQuery = `
                SELECT * FROM streak 
                WHERE student_id = ?
            `;

            db.query(getStreakQuery, [student_id], (err, streaks) => {
                if (err) {
                    console.error('Error fetching streak:', err);
                    return res.status(500).json({ message: 'Failed to fetch streak' });
                }

                const currentDate = new Date();
                let streakValue = 1;
                let lastRecordDate = currentDate;

                if (streaks.length > 0) {
                    const streak = streaks[0];
                    const lastRecord = new Date(streak.last_record_time);
                    const oneDay = 24 * 60 * 60 * 1000;

                    if (currentDate - lastRecord === oneDay) {
                        streakValue = streak.streak_value + 1;
                    } else if (currentDate - lastRecord < oneDay) {
                        streakValue = streak.streak_value;
                    } else {
                        streakValue = 1; // Reset streak if more than a day has passed
                    }

                    lastRecordDate = currentDate;

                    const updateStreakQuery = `
                        UPDATE streak 
                        SET streak_value = ?, last_record_time = ? 
                        WHERE student_id = ?
                    `;

                    db.query(updateStreakQuery, [streakValue, lastRecordDate, student_id], (err) => {
                        if (err) {
                            console.error('Error updating streak:', err);
                            return res.status(500).json({ message: 'Failed to update streak' });
                        }

                        return res.json({ message: 'Daily record and streak updated successfully', streakValue });
                    });
                } else {
                    const insertStreakQuery = `
                        INSERT INTO streak (streak_value, student_id, last_record_time) 
                        VALUES (?, ?, ?)
                    `;

                    db.query(insertStreakQuery, [streakValue, student_id, lastRecordDate], (err) => {
                        if (err) {
                            console.error('Error inserting streak:', err);
                            return res.status(500).json({ message: 'Failed to add streak' });
                        }

                        return res.json({ message: 'Daily record and streak added successfully', streakValue });
                    });
                }
            });
        });
    });
});


app.post('/api/logout', (req, res) => {
    // Simply return a success response indicating logout
    res.json({ message: 'Logged out successfully' });
});

app.get('/api/student-details/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.params.student_id; // Use req.params to get the student_id from the URL
    const query = `
      SELECT student_number, student_name, student_email, course_name, academic_year_name AS academic_year
      FROM student 
      JOIN course ON student.course_id = course.course_id 
      JOIN academic_year ON student.course_year_id = academic_year.academic_year_id 
      WHERE student_id = ?`;

    db.query(query, [studentId], (err, results) => {
        if (err) {
            console.error('Error fetching student details:', err);
            return res.status(500).json({ error: 'Failed to fetch student details' });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        const studentDetails = results[0];
        res.json(studentDetails);
    });
});

app.post('/api/change-password', async (req, res) => {
    const { userId, currentPassword, newPassword } = req.body;

    // Query to fetch the user's current hashed password
    const getUserQuery = `SELECT student_password FROM student WHERE student_id = ?`;
    db.query(getUserQuery, [userId], (err, results) => {
        if (err) {
            console.error('Error fetching user:', err);
            res.status(500).json({ message: 'Error fetching user' });
            return;
        }

        if (results.length === 0) {
            res.status(404).json({ message: 'User not found' });
            return;
        }

        const hashedPassword = results[0].student_password;

        // Compare the current password with the hashed password
        bcrypt.compare(currentPassword, hashedPassword, (err, isMatch) => {
            if (err) {
                console.error('Error comparing passwords:', err);
                res.status(500).json({ message: 'Error comparing passwords' });
                return;
            }

            if (!isMatch) {
                res.status(401).json({ message: 'Current password is incorrect' });
                return;
            }

            // Hash the new password
            bcrypt.hash(newPassword, saltRounds, (err, newHashedPassword) => {
                if (err) {
                    console.error('Error hashing new password:', err);
                    res.status(500).json({ message: 'Error hashing new password' });
                    return;
                }

                // Update the user's password in the database
                const updatePasswordQuery = `UPDATE student SET student_password = ? WHERE student_id = ?`;
                db.query(updatePasswordQuery, [newHashedPassword, userId], (err) => {
                    if (err) {
                        console.error('Error updating password:', err);
                        res.status(500).json({ message: 'Error updating password' });
                        return;
                    }

                    res.json({ message: 'Password changed successfully' });
                });
            });
        });
    });
});

app.get('/api/staff-details/:staff_id', verifyTokenStaff, (req, res) => {
    console.log('User:', req.user); // Log the user object
    console.log('Params:', req.params); // Log the params
    const staffId = req.params.staff_id;
    console.log('the staff id is: ' + staffId);
    const query = 'SELECT staff_name FROM staff WHERE staff_id = ?';
    db.query(query, [staffId], (err, results) => {
        if (err) {
            console.error('Error fetching staff details:', err);
            return res.status(500).json({ error: 'Failed to fetch staff details' });
        }
        if (results.length === 0) {
            return res.status(404).json({ error: 'Staff not found' });
        }
        const staffDetails = results[0];
        res.json(staffDetails);
    });
});


app.get('/api/streak/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.params.student_id;
    const getStreakQuery = `SELECT streak_value FROM streak WHERE student_id = ?`;

    db.query(getStreakQuery, [studentId], (err, streaks) => {
        if (err) {
            console.error('Error fetching streak:', err);
            return res.status(500).json({ message: 'Failed to fetch streak' });
        }

        if (streaks.length > 0) {
            const streakValue = streaks[0].streak_value;
            return res.json({ streakValue: streakValue });
        } else {
            return res.json({ streakValue: 0 });
        }
    });
});


app.get('/api/mood/status', verifyTokenStudent, (req, res) => {
    const studentId = req.user.student_id;
    const today = new Date().toISOString().split('T')[0];
    console.log(`Checking records for student ID: ${studentId} on ${today}`);

    const query = 'SELECT * FROM daily_record WHERE student_id = ? AND DATE(daily_record_timestamp) = ?';
    db.query(query, [studentId, today], (err, results) => {
        if (err) {
            console.error('Error fetching mood:', err);
            return res.status(500).send('Error occurred');
        }
        if (results.length > 0) {
            console.log('AlreadyTracked set to true');
            return res.json({ alreadyTracked: true });
        } else {
            console.log('AlreadyTracked set to false');
            return res.json({ alreadyTracked: false });
        }
    });
});

const cooldownPeriodSeconds = 1 * 60 * 60;

app.post('/api/quick-track', verifyTokenStudent, (req, res) => {
    const studentId = req.user.student_id; // Ensure this line correctly retrieves student_id
    const { mood_id } = req.body;

    // Check if studentId is defined
    if (!studentId) {
        return res.status(400).json({ error: 'Student ID is missing or invalid' });
    }

    const checkLastSubmissionQuery = `SELECT quick_track_timestamp FROM quick_track 
                                        WHERE student_id = ? 
                                        ORDER BY quick_track_timestamp DESC 
                                        LIMIT 1`;

    db.query(checkLastSubmissionQuery, [studentId], (err, results) => {
        if (err) {
            console.error('Error checking last submission:', err);
            return res.status(500).json({ error: 'Failed to check last submission' });
        }

        if (results.length > 0) {
            const lastSubmissionTime = new Date(results[0].quick_track_timestamp);
            const now = new Date();
            const cooldownEndTime = new Date(lastSubmissionTime.getTime() + cooldownPeriodSeconds * 1000);

            if (now < cooldownEndTime) {

                const remainingSeconds = Math.floor((cooldownEndTime - now) / 1000);
                return res.status(409).json({
                    message: 'Cooldown period active',
                    remainingTimeSeconds: remainingSeconds
                });
            }
        }

        const insertQuery = `
        INSERT INTO quick_track (student_id, mood_id )
        VALUES (?, ?)
    `;

        db.query(insertQuery, [studentId, mood_id], (err, result) => {
            if (err) {
                console.error('Error inserting quick track:', err);
                return res.status(500).json({ error: 'Failed to add quick track' });
            }
            res.json({ message: 'Quick track added successfully' });
        });
    });
});

app.get('/api/quick-tracker/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.user.student_id;

    const getQuickTrackerQuery = `
        SELECT * FROM quick_track 
        JOIN moods ON moods.mood_id = quick_track.mood_id
        WHERE student_id = ?
        ORDER BY quick_track_timestamp DESC
    `;

    db.query(getQuickTrackerQuery, [studentId], (err, records) => {
        if (err) {
            console.error('Error fetching quick tracker records:', err);
            return res.status(500).json({ message: 'Failed to fetch quick tracker records' });
        }

        return res.json({ records });
    });
});

app.post('/api/check-student', (req, res) => {
    const { studentNumber, studentEmail } = req.body;
    const query = `
        SELECT * FROM student
        WHERE student_number = ? OR student_email = ?
    `;
    db.query(query, [studentNumber, studentEmail], (err, results) => {
        if (err) {
            console.error('Error checking student existence:', err);
            return res.status(500).json({ error: 'Failed to check student existence' });
        }
        if (results.length > 0) {
            return res.json({ exists: true });
        }
        res.json({ exists: false });
    });
});

app.get('/api/records/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.params.student_id;

    const getRecordsQuery = `
        SELECT * FROM daily_record dr 
        JOIN moods m ON m.mood_id = dr.mood_id
        JOIN socialisation s ON s.socialisation_id = dr.socialisation_id
        JOIN exercise e ON e.exercise_id = dr.exercise_id
        JOIN sleep sl ON sl.sleep_id = dr.sleep_id
        WHERE dr.student_id = ?
        ORDER BY daily_record_timestamp DESC
        `;

    db.query(getRecordsQuery, [studentId], (err, records) => {
        if (err) {
            console.error('Error fetching records:', err);
            return res.status(500).json({ message: 'Failed to fetch records' });
        }

        return res.json({ records });
    });
});



app.get('/api/assignments/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.params.student_id;

    const getAssignmentsQuery = `
        SELECT *
        FROM assignment 
        WHERE student_id = ?
        ORDER BY assignment_deadline ASC
    `;

    db.query(getAssignmentsQuery, [studentId], (err, assignments) => {
        if (err) {
            console.error('Error fetching assignments:', err);
            return res.status(500).json({ message: 'Failed to fetch assignments' });
        }

        return res.json({ assignments });
    });
});

app.delete('/api/assignments/:assignment_id', verifyTokenStudent, (req, res) => {
    const assignmentId = req.params.assignment_id;

    const deleteAssignmentQuery = `
        DELETE FROM assignment 
        WHERE assignment_id = ? 
    `;

    db.query(deleteAssignmentQuery, [assignmentId], (err) => {
        if (err) {
            console.error('Error deleting assignment from assignment:', err);
            return res.status(500).json({ message: 'Failed to delete assignment' });
        }

        res.json({ message: 'Assignment deleted successfully' });
    });
});

app.post('/api/assignments', verifyTokenStudent, (req, res) => {
    const { student_id, assignment_name, assignment_deadline } = req.body;

    const insertAssignmentQuery = `
        INSERT INTO assignment (student_id, assignment_name, assignment_deadline)
        VALUES (?, ?, ?)
    `;

    db.query(insertAssignmentQuery, [student_id, assignment_name, assignment_deadline], (err, result) => {
        if (err) {
            console.error('Error inserting assignment:', err);
            return res.status(500).json({ message: 'Failed to add assignment' });
        }

        res.json({ message: 'Assignment added successfully', assignment: { assignment_id: result.insertId, student_id, assignment_name, assignment_deadline } });
    });
});

app.put('/api/assignments/:assignment_id', verifyTokenStudent, (req, res) => {
    const assignmentId = req.params.assignment_id;
    const { assignment_name, assignment_deadline } = req.body;

    const updateAssignmentQuery = `
        UPDATE assignment 
        SET assignment_name = ?, assignment_deadline = ?
        WHERE assignment_id = ?
    `;

    db.query(updateAssignmentQuery, [assignment_name, assignment_deadline, assignmentId], (err) => {
        if (err) {
            console.error('Error updating assignment:', err);
            return res.status(500).json({ message: 'Failed to update assignment' });
        }

        res.json({ message: 'Assignment updated successfully' });
    });
});

app.get('/api/mood-scores/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.params.student_id;

    const getMoodScoresQuery = `
        SELECT m.mood_score,m.mood_name, dr.daily_record_timestamp
        FROM daily_record dr
        JOIN moods m ON m.mood_id = dr.mood_id
        WHERE dr.student_id = ?
        ORDER BY dr.daily_record_timestamp ASC
    `;

    db.query(getMoodScoresQuery, [studentId], (err, results) => {
        if (err) {
            console.error('Error fetching mood scores:', err);
            return res.status(500).json({ message: 'Failed to fetch mood scores' });
        }

        return res.json({ moodScores: results });
    });
});

// app.get('/api/exercise-minutes/:student_id', verifyTokenStudent, (req, res) => {
//     const studentId = req.user.student_id;

//     const getExerciseMinutesQuery = `
//         SELECT daily_record_timestamp, exercise_duration
//         FROM daily_record
//         WHERE student_id = ?
//         ORDER BY daily_record_timestamp ASC
//     `;

//     db.query(getExerciseMinutesQuery, [studentId], (err, records) => {
//         if (err) {
//             console.error('Error fetching exercise minutes:', err);
//             return res.status(500).json({ message: 'Failed to fetch exercise minutes' });
//         }

//         return res.json({ exerciseMinutes: records });
//     });
// });

app.get('/api/exercise-time/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.user.student_id;
    const getExerciseTimeQuery = `
    SELECT daily_record_timestamp, exercise_name, exercise_score
    FROM daily_record JOIN exercise ON exercise.exercise_id = daily_record.exercise_id
    WHERE student_id = ?
    ORDER BY daily_record_timestamp ASC
`;

    db.query(getExerciseTimeQuery, [studentId], (err, records) => {
        if (err) {
            console.error('Error fetching exercise time:', err);
            return res.status(500).json({ message: 'Failed to fetch exercise time' });
        }

        return res.json({ exerciseTime: records });
    });
})

app.get('/api/sleep-rating/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.user.student_id;

    const query = `
        SELECT daily_record_timestamp, sleep_id 
        FROM daily_record
        WHERE student_id = ?
        ORDER BY daily_record_timestamp ASC
    `;

    db.query(query, [studentId], (err, results) => {
        if (err) {
            console.error('Error fetching sleep rating:', err);
            return res.status(500).json({ error: 'Failed to fetch sleep rating' });
        }

        res.json({ sleepRating: results });
    });
});


// Route to get productivity scores for a student
app.get('/api/productivity-scores/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.user.student_id;

    const query = `
        SELECT daily_record_timestamp, productivity_score 
        FROM daily_record
        WHERE student_id = ?
        ORDER BY daily_record_timestamp ASC
    `;

    db.query(query, [studentId], (err, results) => {
        if (err) {
            console.error('Error fetching productivity scores:', err);
            return res.status(500).json({ error: 'Failed to fetch productivity scores' });
        }

        res.json({ productivityScores: results });
    });
});

// Route to get sleep durations for a student
// app.get('/api/sleep-durations/:student_id', verifyTokenStudent, (req, res) => {
//     const studentId = req.user.student_id;

//     const query = `
//         SELECT daily_record_timestamp, sleep_duration 
//         FROM daily_record
//         WHERE student_id = ?
//         ORDER BY daily_record_timestamp ASC
//     `;

//     db.query(query, [studentId], (err, results) => {
//         if (err) {
//             console.error('Error fetching sleep durations:', err);
//             return res.status(500).json({ error: 'Failed to fetch sleep durations' });
//         }

//         res.json({ sleepDurations: results });
//     });
// });

app.get('/api/socialisation/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.user.student_id;
    const query = `SELECT dr.daily_record_timestamp, s.socialisation_score, s.socialisation_name
    FROM daily_record dr JOIN socialisation s ON s.socialisation_id = dr.socialisation_id WHERE student_id = ? 
    ORDER BY daily_record_timestamp ASC`;

    db.query(query, [studentId], (err, results) => {
        if (err) {
            console.error('Error fetching socialisation:', err);
            return res.status(500).json({ error: 'Failed to fetch socialisation' });
        }

        res.json({ socialisationScores: results });
    });
});

app.get('/api/stats/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.params.student_id;

    const query = `
        SELECT dr.daily_record_timestamp, e.exercise_score, sl.sleep_score, s.socialisation_score, m.mood_score, dr.productivity_score
        FROM daily_record dr
        JOIN  socialisation s ON s.socialisation_id = dr.socialisation_id
        JOIN moods m ON m.mood_id = dr.mood_id
        JOIN exercise e ON e.exercise_id = dr.exercise_id
        JOIN sleep sl ON sl.sleep_id = dr.sleep_id
        WHERE student_id = ? AND daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
        ORDER BY daily_record_timestamp ASC
    `;

    db.query(query, [studentId], (err, results) => {
        if (err) {
            console.error('Error fetching stats:', err);
            return res.status(500).json({ message: 'Failed to fetch stats' });
        }
        const calculateAverage = (data, key) => {
            const sum = data.reduce((acc, record) => acc + record[key], 0);
            return data.length ? (sum / data.length).toFixed(1) : 0;
        };

        const todayRecord = results[results.length - 1];
        const last7DaysRecords = results.slice(0, -1);
        const averages = {
            mood: calculateAverage(last7DaysRecords, 'mood_score'),
            exercise: calculateAverage(last7DaysRecords, 'exercise_score'),
            sleep: calculateAverage(last7DaysRecords, 'sleep_score'),
            socialisation: calculateAverage(last7DaysRecords, 'socialisation_score'),
            productivity: calculateAverage(last7DaysRecords, 'productivity_score'),
        };

        const stats = {
            today: {
                mood: todayRecord.mood_score,
                exercise: todayRecord.exercise_score,
                sleep: todayRecord.sleep_score,
                socialisation: todayRecord.socialisation_score,
                productivity: todayRecord.productivity_score,
            },
            averages: {
                mood: averages.mood,
                exercise: averages.exercise,
                sleep: averages.sleep,
                socialisation: averages.socialisation,
                productivity: averages.productivity,
            },
            trends: {
                mood: todayRecord.mood_score - averages.mood,
                exercise: todayRecord.exercise_score - averages.exercise,
                sleep: todayRecord.sleep_score - averages.sleep,
                socialisation: todayRecord.socialisation_score - averages.socialisation,
                productivity: todayRecord.productivity_score - averages.productivity,
            },
        };


        res.json({ stats });
    });
});


app.get('/api/students', verifyTokenStaff, async (req, res) => {
    try {

        const studentsQuery = `
        SELECT 
            s.student_id, 
            s.student_name, 
            s.student_number, 
            COALESCE(MAX(dr.daily_record_timestamp), MAX(qt.quick_track_timestamp)) AS last_recording_date
        FROM student s
        LEFT JOIN daily_record dr ON s.student_id = dr.student_id
        LEFT JOIN quick_track qt ON s.student_id = qt.student_id
        GROUP BY s.student_id
    `;
        const [students] = await db.promise().query(studentsQuery);

        const moodTrends = await Promise.all(students.map(async (student) => {
            const statsQuery = `
          SELECT m.mood_score, dr.daily_record_timestamp
          FROM daily_record dr
          JOIN moods m ON m.mood_id = dr.mood_id
          WHERE dr.student_id = ? AND dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
          ORDER BY dr.daily_record_timestamp ASC
        `;

            const [stats] = await db.promise().query(statsQuery, [student.student_id]);

            const moodTrend = stats.length < 2 ? null : calculateTrend(stats, 'mood_score');

            return { studentId: student.student_id, moodTrend };
        }));

        const studentsWithMood = students.map((student) => {
            const moodTrend = moodTrends.find((trend) => trend.studentId === student.student_id)?.moodTrend || 'no record';
            return { ...student, moodTrend };
        });


        res.json({ students: studentsWithMood });
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ message: 'Failed to fetch students' });
    }
});

app.get('/api/student-distribution', verifyTokenStaff, async (req, res) => {
    try {
        const courseQuery = `
            SELECT c.course_name, ay.academic_year_name, COUNT(s.student_id) as student_count
        FROM student s
        JOIN course c ON s.course_id = c.course_id
        JOIN academic_year ay ON s.course_year_id = ay.academic_year_id
        GROUP BY c.course_name, ay.academic_year_name
      `;
        const [distribution] = await db.promise().query(courseQuery);
        res.json({ distribution });
    } catch (error) {
        console.error('Error fetching student distribution:', error);
        res.status(500).json({ message: 'Failed to fetch student distribution' });
    }
});

app.get('/api/wellness-trends', verifyTokenStaff, async (req, res) => {
    try {
        const trendsQuery = `
        SELECT DATE_FORMAT(dr.daily_record_timestamp, '%Y-%m-%d') as date, 
          AVG(m.mood_score) as avg_mood, 
          AVG(e.exercise_score) as avg_exercise,
          AVG(sl.sleep_score) as avg_sleep,
          AVG(s.socialisation_score) as avg_socialisation
        FROM daily_record dr
        JOIN moods m ON dr.mood_id = m.mood_id
        JOIN socialisation s ON dr.socialisation_id = s.socialisation_id
        JOIN exercise e ON dr.exercise_id = e.exercise_id
        JOIN sleep sl ON dr.sleep_id = sl.skeep_id
        GROUP BY date
        ORDER BY date
      `;
        const [trends] = await db.promise().query(trendsQuery);
        res.json({ trends });
    } catch (error) {
        console.error('Error fetching wellness trends:', error);
        res.status(500).json({ message: 'Failed to fetch wellness trends' });
    }
});

app.get('/api/productivity-trends', verifyTokenStaff, async (req, res) => {
    try {
        const productivityQuery = `
        SELECT DATE_FORMAT(dr.daily_record_timestamp, '%Y-%m-%d') as date, 
          AVG(dr.productivity_score) as avg_productivity
        FROM daily_record dr
        GROUP BY date
        ORDER BY date
      `;
        const [trends] = await db.promise().query(productivityQuery);
        res.json({ trends });
    } catch (error) {
        console.error('Error fetching productivity trends:', error);
        res.status(500).json({ message: 'Failed to fetch productivity trends' });
    }
});

app.get('/api/aggregated-data', verifyTokenStaff, (req, res) => {
    const { metrics, academicYear, course } = req.query;

    let baseQuery = `
        SELECT dr.daily_record_timestamp,
    `;
    let joins = `
        FROM daily_record dr
    `;
    let conditions = `WHERE 1=1`;

    // Add metrics to the query
    const metricsMap = {
        mood: 'm.mood_score',
        exercise: 'e.exercise_score',
        sleep: 'sl.sleep_score',
        socialisation: 's.socialisation_score',
        productivity: 'dr.productivity_score',
    };

    metrics.split(',').forEach(metric => {
        baseQuery += `${metricsMap[metric]}, `;
        if (metric === 'mood') joins += `JOIN moods m ON m.mood_id = dr.mood_id `;
        if (metric === 'socialisation') joins += `JOIN socialisation s ON s.socialisation_id = dr.socialisation_id `;
        if (metric === 'exercise') joins += `JOIN exercise e ON e.exercise_id = dr.exercise_id `;
        if (metric === 'sleep') joins += `JOIN sleep sl ON sl.sleep_id = dr.sleep_id `;
    });

    // Add academic year and course filters
    if (academicYear) {
        conditions += ` AND dr.academic_year_id = ${academicYear}`;
    }
    if (course) {
        conditions += ` AND dr.course_id = ${course}`;
    }

    // Finalize the query
    const finalQuery = `${baseQuery.slice(0, -2)} ${joins} ${conditions} ORDER BY dr.daily_record_timestamp ASC`;

    db.query(finalQuery, (err, results) => {
        if (err) {
            console.error('Error fetching aggregated data:', err);
            return res.status(500).json({ message: 'Failed to fetch aggregated data' });
        }

        return res.json({ data: results });
    });
});

// Route to get the number of students signed up
app.get('/api/number-of-students', verifyTokenStaff, (req, res) => {
    const query = 'SELECT COUNT(*) as totalStudents FROM student';

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching the number of students:', err);
            return res.status(500).json({ message: 'Failed to fetch the number of students' });
        }

        res.json({ totalStudents: results[0].totalStudents });
    });
});

// Route to get the number of students who recorded today
app.get('/api/students-recorded-today', verifyTokenStaff, (req, res) => {
    const query = `
        SELECT COUNT(DISTINCT student_id) as studentsRecordedToday 
        FROM daily_record 
        WHERE DATE(daily_record_timestamp) = CURDATE()
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching the number of students who recorded today:', err);
            return res.status(500).json({ message: 'Failed to fetch the number of students who recorded today' });
        }

        res.json({ studentsRecordedToday: results[0].studentsRecordedToday });
    });
});

// Route to get the distribution of course years among the students signed up
app.get('/api/course-year-distribution', verifyTokenStaff, (req, res) => {
    const query = `
        SELECT ay.academic_year_name, COUNT(s.student_id) as count
        FROM student s
        JOIN academic_year ay ON s.course_year_id = ay.academic_year_id
        GROUP BY ay.academic_year_name
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching course year distribution:', err);
            return res.status(500).json({ message: 'Failed to fetch course year distribution' });
        }

        res.json(results);
    });
});

// Route to get the distribution of courses among the students signed up
app.get('/api/course-distribution', verifyTokenStaff, (req, res) => {
    const query = `
        SELECT c.course_name, COUNT(s.student_id) as count
        FROM student s
        JOIN course c ON s.course_id = c.course_id
        GROUP BY c.course_name
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching course distribution:', err);
            return res.status(500).json({ message: 'Failed to fetch course distribution' });
        }

        res.json(results);
    });
});

app.get('/api/resources', verifyTokenStudent, async (req, res) => {
    try {
        const limit = req.query.limit ? parseInt(req.query.limit) : null;
        let query = `
      SELECT r.resource_added_date, r.resource_name, rt.resource_topic_name, r.resource_topic_id, r.resource_link FROM resources r 
    JOIN resource_topic rt ON rt.resource_topic_id = r.resource_topic_id ORDER BY r.resource_added_date DESC
        `;
        if (limit) {
            query += ` LIMIT ${limit}`;
        }
        const [resources] = await db.promise().query(query);
        res.json({ resources });
    
    } catch (error) {
        console.error('Error fetching resources:', error);
        res.status(500).json({ message: 'Failed to fetch resources' });
    }
});

// Get all resources
app.get('/api/resource-topics', verifyTokenStaff, (req, res) => {
    db.query('SELECT * FROM resource_topic', (err, results) => {
        if (err) {
            console.error('Error fetching resource topics:', err);
            return res.status(500).json({ message: 'Failed to fetch resource topics' });
        }
        res.json({ resourceTopics: results });
    });
});

app.get('/api/staff-resources', verifyTokenStaff, (req, res) => {
    db.query(`SELECT * FROM resources r
        JOIN resource_topic rt WHERE rt.resource_topic_id = r.resource_topic_id  
        ORDER BY r.resource_added_date DESC`, (err, results) => {
        if (err) {
            console.error('Error fetching resources:', err);
            return res.status(500).json({ message: 'Failed to fetch resources' });
        }
      
        res.json({ resources: results });
    });
});

// Add a new resource
app.post('/api/staff-resources', verifyTokenStaff, (req, res) => {
    const { resource_name, resource_link, resource_topic_id } = req.body;
    db.query('INSERT INTO resources (resource_name, resource_link, resource_topic_id) VALUES (?, ?, ?)', [resource_name, resource_link, resource_topic_id], (err, result) => {
        if (err) {
            console.error('Error adding resource:', err);
            return res.status(500).json({ message: 'Failed to add resource' });
        }
        res.json({ message: 'Resource added successfully' });
    });
});


// Update a resource
app.put('/api/staff-resources/:resource_id', verifyTokenStaff, (req, res) => {
    const { resource_id } = req.params;
    const { resource_name, resource_link } = req.body;
    db.query('UPDATE resources SET resource_name = ?, resource_link = ? WHERE resource_id = ?', [resource_name, resource_link, resource_id], (err) => {
        if (err) {
            console.error('Error updating resource:', err);
            return res.status(500).json({ message: 'Failed to update resource' });
        }
        res.json({ message: 'Resource updated successfully' });
    });
});

// Delete a resource
app.delete('/api/staff-resources/:resource_id', verifyTokenStaff, (req, res) => {
    const { resource_id } = req.params;
    db.query('DELETE FROM resources WHERE resource_id = ?', [resource_id], (err) => {
        if (err) {
            console.error('Error deleting resource:', err);
            return res.status(500).json({ message: 'Failed to delete resource' });
        }
        res.json({ message: 'Resource deleted successfully' });
    });
});

app.get('/api/recommended-resources/:student_id', verifyTokenStudent, async (req, res) => {
    const studentId = req.params.student_id;

    try {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const formattedDate = threeDaysAgo.toISOString().split('T')[0];

        const query = `
            SELECT 
                r.resource_name, r.resource_link, rt.resource_topic_name, dr.daily_record_timestamp
            FROM 
                daily_record dr
            JOIN 
                resources r ON r.resource_topic_id = (
                    CASE 
                        WHEN dr.mood_id IN (SELECT mood_id FROM moods WHERE mood_score < 5) THEN 1 -- Assuming 1 is the topic ID for mood resources
                        WHEN dr.exercise_id IN (SELECT exercise_id FROM exercise WHERE exercise_score < 5) THEN 2 -- Assuming 2 is the topic ID for exercise resources
                        -- Add more cases as needed
                    END
                )
            JOIN 
                resource_topic rt ON rt.resource_topic_id = r.resource_topic_id
            WHERE 
                dr.student_id = ? AND DATE(dr.daily_record_timestamp) >= ?
            ORDER BY 
                dr.daily_record_timestamp DESC
            LIMIT 3;
        `;

        const [resources] = await db.promise().query(query, [studentId, formattedDate]);

        res.json({ resources });
    } catch (error) {
        console.error('Error fetching recommended resources:', error);
        res.status(500).json({ message: 'Failed to fetch recommended resources' });
    }
});


app.post('/api/send-email', verifyTokenStaff, async (req, res) => {
    const { to, subject, message } = req.body;

    try {
        const emailHtml = `
            <p>${message}</p>
        `;
        sendEmail(to, subject, message, emailHtml);
        res.json({ message: 'Email sent successfully' });
    } catch (error) {
        console.error('Error sending email:', error);
        res.status(500).json({ message: 'Failed to send email' });
    }
});

app.get('/api/student-profile/:student_id', verifyTokenStaff, async (req, res) => {
    const studentId = req.params.student_id;

    try {
        const studentQuery = `
            SELECT s.student_name, s.student_email, s.student_number, c.course_name, ay.academic_year_name,
            COALESCE(MAX(dr.daily_record_timestamp), MAX(qt.quick_track_timestamp)) AS last_recording_date
            FROM student s
            LEFT JOIN daily_record dr ON s.student_id = dr.student_id
            LEFT JOIN quick_track qt ON s.student_id = qt.student_id
            LEFT JOIN course c ON s.course_id = c.course_id
            LEFT JOIN academic_year ay ON s.course_year_id = ay.academic_year_id
            WHERE s.student_id = ?
            GROUP BY s.student_id
        `;
        const [student] = await db.promise().query(studentQuery, [studentId]);
        console.log('Query result:', student);

        if (student.length === 0) {
            return res.status(404).json({ message: 'Student not found' });
        }

        res.json(student[0]);
    } catch (error) {
        console.error('Error fetching student profile:', error);
        res.status(500).json({ message: 'Failed to fetch student profile' });
    }
});




app.listen(8000, () => {
    console.log('server is running on port 8000')
    db.connect(function (err) {
        if (err) throw err;
        console.log('connected to db');
    })
});