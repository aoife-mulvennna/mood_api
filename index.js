const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const cron = require('node-cron');
const sendEmail = require('./utils/emailUtils');
const { Parser } = require('json2csv');
const fs = require('fs');
const path = require('path');
const moment = require('moment');

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
// Schedule a job to run every day at midnight to alert student that they have not recorded in 5 days (currently set to 1 minute)
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
                    <p>Best regards,</p>
                    <p>QUB Student Pulse</p>
                `;
                sendEmail(staff_email, 'Student Activity Alert', emailMessage, emailHtml);
            }
        });
    } catch (error) {
        console.error('Error running scheduled job:', error);
    }
});

// CRON Job to alert students if their 7-day average mood score has reduced to under 3
//calculates 7 day average mood score 
cron.schedule('0 0 * * *', async () => {
    try {
        const query = `
            SELECT s.student_id, s.student_email, s.student_name, AVG(m.mood_score) as avg_mood_score
            FROM student s
            JOIN daily_record dr ON s.student_id = dr.student_id
            JOIN moods m ON m.mood_id = dr.mood_id
            WHERE dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY s.student_id, s.student_email, s.student_name
            HAVING avg_mood_score < 3
        `;

        db.query(query, async (err, results) => {
            if (err) {
                console.error('Error checking 7-day average mood scores:', err);
                return;
            }

            for (const student of results) {
                const { student_email, student_name, avg_mood_score } = student;
                const emailMessage = `Dear ${student_name},\n\nWe have noticed that your average mood score over the past 7 days has dropped below 3. If you are feeling down, please reach out to our support team or seek help from friends and family.`;
                const emailHtml = `
                    <p>Dear ${student_name},</p>
                    <p>We have noticed that your average mood score over the past 7 days has dropped below 3. If you are feeling down, please reach out to our support team or seek help from friends and family.</p>
                    <p>Best regards,</p>
                    <p>The Student Pulse Team</p>
                `;
                sendEmail(student_email, 'Low Mood Alert', emailMessage, emailHtml);
            }
        });
    } catch (error) {
        console.error('Error running scheduled job:', error);
    }
});

// CRON Job to alert staff if a student's 7-day average mood score has reduced to under 2
cron.schedule('0 0 * * *', async () => {
    try {
        const query = `
            SELECT s.student_id, s.student_email, s.student_name, st.staff_email, AVG(m.mood_score) as avg_mood_score
            FROM student s
            JOIN daily_record dr ON s.student_id = dr.student_id
            JOIN moods m ON m.mood_id = dr.mood_id
            JOIN staff st ON st.staff_id = s.staff_id
            WHERE dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            GROUP BY s.student_id, s.student_email, s.student_name, st.staff_email
            HAVING avg_mood_score < 2
        `;

        db.query(query, async (err, results) => {
            if (err) {
                console.error('Error checking 7-day average mood scores for staff alert:', err);
                return;
            }

            for (const student of results) {
                const { student_email, student_name, staff_email, avg_mood_score } = student;
                const emailMessage = `Dear Staff,\n\nStudent ${student_name} has an average mood score of less than 2 over the past 7 days. Please check in with them to ensure they are okay and offer any necessary support.\n\nBest regards,\nThe Student Pulse Team`;
                const emailHtml = `
                    <p>Dear Staff,</p>
                    <p>Student ${student_name} has an average mood score of less than 2 over the past 7 days. Please check in with them to ensure they are okay and offer any necessary support.</p>
                      <p>Best regards,</p>
                    <p>QUB Student Pulse</p>
                `;
                sendEmail(staff_email, 'Student Low Mood Alert', emailMessage, emailHtml);
            }
        });
    } catch (error) {
        console.error('Error running scheduled job for staff alert:', error);
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
                            INSERT INTO streak (streak_value, student_id) 
                            VALUES (0, ?)
                        `;
                        db.query(initialStreakQuery, [student_id], (err) => {
                            if (err) {
                                console.error('Error inserting initial streak:', err);
                                res.status(500).json({ message: 'Failed to create initial streak' });
                                return;
                            }
                            const emailMessage = `Hello ${student_name},\n\nYour account has been successfully created. Welcome!`;
                            const loginLink = `${process.env.FRONTEND_URL_STUDENT}/login`; // Link to the login page
                            const emailHtml = `
                                <p>Hello ${student_name},</p>
                                <p>Your account has been successfully created. Welcome to our platform! Click the button below to log in:</p>
                                <a href="${loginLink}" style="display: inline-block; padding: 10px 20px; font-size: 16px; color: white; background-color: blue; text-decoration: none; border-radius: 5px;">Log In</a>
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

        const resetLink = `${process.env.FRONTEND_URL_STUDENT}/reset-password/${token}`;
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

app.post('/api/forgot-staff-password', async (req, res) => {
    const { email } = req.body;

    const userQuery = 'SELECT * FROM staff WHERE staff_email = ?';
    db.query(userQuery, [email], async (err, results) => {
        if (err) {
            console.error('Error fetching staff:', err);
            return res.status(500).json({ message: 'Error occurred while fetching staff' });
        }

        if (results.length === 0) {
            return res.status(404).json({ message: 'No account found with that email' });
        }

        const user = results[0];
        const token = jwt.sign({ id: user.staff_id }, process.env.JWT_SECRET, { expiresIn: '1h' });

        const resetLink = `${process.env.FRONTEND_URL_STAFF}/reset-staff-password/${token}`;
        const emailMessage = `Click the following link to reset your password: ${resetLink}`;
        const emailHtml = `       
        <p>Hi ${user.staff_name},</p>
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

app.post('/api/reset-staff-password', async (req, res) => {
    const { token, password } = req.body;

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const hashedPassword = await bcrypt.hash(password, 10);

        const updateQuery = 'UPDATE staff SET staff_password = ? WHERE staff_id = ?';
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


// app.get('/', (req, res) => {
//     console.log('recieved a get request');
//     res.send('hello world');
// });

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

app.get('/api/tags', (req, res) => {
    const query = `SELECT * from tag`;
    db.query(query, function (err, rows, fields) {
        if (err) {
            console.error('Error fetching tags:', err);
            res.status(500).send('Failed to fetch tags');
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
    const { student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score, tags } = req.body;
            console.log(req.body);
    // Check these are not null or undefined and allow 0.
    if (mood_id == null || exercise_id == null || sleep_id == null || socialisation_id == null || productivity_score == null) {

        return res.status(400).json({ message: 'Please complete all fields' });
    }

    const today = new Date().toISOString().split('T')[0];
    const checkRecordQuery = `
        SELECT * FROM daily_record 
        WHERE student_id = ? AND DATE(daily_record_timestamp) = ?
    `;

    db.query(checkRecordQuery, [student_id, today], async (err, records) => {
        if (err) {
            console.error('Error checking daily record:', err);
            return res.status(500).send('Failed to check daily record');
        }
        if (records.length > 0) {
            const dailyRecordId = records[0].daily_record_id;
            const updateQuery = `
                UPDATE daily_record 
                SET mood_id = ?, exercise_id = ?, sleep_id = ?, socialisation_id = ?, productivity_score = ?
                WHERE daily_record_id = ?
            `;

            db.query(updateQuery, [mood_id, exercise_id, sleep_id, socialisation_id, productivity_score, dailyRecordId], async (err) => {
                if (err) {
                    console.error('Error updating daily record:', err);
                    return res.status(500).json({ message: 'Failed to update daily record' });
                }

                await updateTags(dailyRecordId, tags);
                res.json({ message: 'Daily Tracker updated successfully! Thank you.' });
            });
        } else {
            const insertQuery = `
                INSERT INTO daily_record (student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score) 
                VALUES (?, ?, ?, ?, ?, ?)
            `;

            db.query(insertQuery, [student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score], async (err, result) => {
                if (err) {
                    console.error('Error inserting daily record:', err);
                    return res.status(500).json({ message: 'Failed to add daily record' });
                }

                const dailyRecordId = result.insertId;
                await updateTags(dailyRecordId, tags);
                const streakResult = await updateStreak(student_id);
                res.json({ message: 'Daily record added successfully! Thank you.' });
            });
        }
    });
});

app.get('/api/daily-track/:studentId', verifyTokenStudent, (req, res) => {
    const studentId = req.params.studentId;
    const today = new Date().toISOString().split('T')[0];
console.log('today:', today);
    const query = `
        SELECT dr.*, GROUP_CONCAT(drt.tag_id) AS tags 
        FROM daily_record dr
        LEFT JOIN daily_record_tag drt ON dr.daily_record_id = drt.daily_record_id
        WHERE dr.student_id = ? AND DATE(dr.daily_record_timestamp) = ?
        GROUP BY dr.daily_record_id
    `;

    db.query(query, [studentId, today], (err, rows) => {
        if (err) {
            console.error('Error fetching daily record:', err);
            return res.status(500).send('Failed to fetch daily record');
        }

        if (rows.length === 0) {
            return res.status(404).send('No daily record found for today');
        }

        const record = rows[0];
        record.tags = record.tags ? record.tags.split(',').map(Number) : [];
        res.json(record);
    });
});


const updateTags = (dailyRecordId, tags) => {
    return new Promise((resolve, reject) => {
        const deleteTagsQuery = `
            DELETE FROM daily_record_tag 
            WHERE daily_record_id = ?
        `;

        db.query(deleteTagsQuery, [dailyRecordId], (err) => {
            if (err) {
                console.error('Error deleting daily record tags:', err);
                return reject({ message: 'Failed to delete daily record tags' });
            }

            if (tags && tags.length > 0) {
                const tagInserts = tags.map(tag_id => [dailyRecordId, tag_id]);
                const insertTagsQuery = `
                    INSERT INTO daily_record_tag (daily_record_id, tag_id) VALUES ?
                `;

                db.query(insertTagsQuery, [tagInserts], (err) => {
                    if (err) {
                        console.error('Error inserting daily record tags:', err);
                        return reject({ message: 'Failed to add daily record tags' });
                    }

                    resolve();
                });
            } else {
                resolve();
            }
        });
    });
};


const updateStreak = (student_id) => {
    return new Promise((resolve, reject) => {
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);

        const formatDate = (date) => date.toISOString().split('T')[0];

        // console.log(`\n--- Starting Streak Update ---`);
        // console.log(`Updating streak for student_id: ${student_id}`);
        // console.log(`Today's date: ${formatDate(today)}, Yesterday's date: ${formatDate(yesterday)}`);

        const getLastRecordQuery = `
            SELECT DATE(daily_record_timestamp) as last_record_date 
            FROM daily_record 
            WHERE student_id = ? 
            ORDER BY daily_record_timestamp DESC 
            LIMIT 1
        `;

           // Define getCurrentStreakQuery here before using it
           const getCurrentStreakQuery = `
           SELECT streak_value 
           FROM streak 
           WHERE student_id = ?
       `;

        db.query(getLastRecordQuery, [student_id], (err, lastRecords) => {
            if (err) {
                console.error('Error fetching last record:', err);
                return reject({ message: 'Failed to fetch last record' });
            }

            if (lastRecords.length > 0) {
                const lastRecordDate = new Date(lastRecords[0].last_record_date);
                console.log(`Last record date: ${formatDate(lastRecordDate)}`);

                if (formatDate(lastRecordDate) === formatDate(yesterday)) {

                    db.query(getCurrentStreakQuery, [student_id], (err, streaks) => {
                        if (err) {
                            console.error('Error fetching streak:', err);
                            return reject({ message: 'Failed to fetch streak' });
                        }

                        let newStreakValue = 1;
                        if (streaks.length > 0) {
                            newStreakValue = streaks[0].streak_value + 1;
                        }

                        const updateStreakQuery = `
                            UPDATE streak 
                            SET streak_value = ? 
                            WHERE student_id = ?
                        `;

                        db.query(updateStreakQuery, [newStreakValue, student_id], (err, result) => {
                            if (err) {
                                console.error('Error updating streak:', err);
                                return reject({ message: 'Failed to update streak' });
                            }

                            // Log the streak value after update
                            db.query(getCurrentStreakQuery, [student_id], (err, finalStreaks) => {
                                if (err) {
                                    console.error('Error fetching final streak:', err);
                                    return reject({ message: 'Failed to fetch final streak' });
                                }

                                resolve({ streakValue: newStreakValue });
                            });
                        });
                    });
                } else {
                    console.log('Last record was not yesterday, resetting streak to 1.');

                    const resetStreakQuery = `
                        UPDATE streak 
                        SET streak_value = 1 
                        WHERE student_id = ?
                    `;

                    db.query(resetStreakQuery, [student_id], (err, result) => {
                        if (err) {
                            console.error('Error resetting streak:', err);
                            return reject({ message: 'Failed to reset streak' });
                        }

                        // Log the streak value after reset
                        db.query(getCurrentStreakQuery, [student_id], (err, finalStreaks) => {
                            if (err) {
                                console.error('Error fetching final streak after reset:', err);
                                return reject({ message: 'Failed to fetch final streak after reset' });
                            }

                            console.log('Final streak query result after reset:', finalStreaks);
                            resolve({ streakValue: 1 });
                        });
                    });
                }
            } else {
                console.log('No previous records found, starting a new streak at 1.');

                const insertStreakQuery = `
                    INSERT INTO streak (streak_value, student_id) 
                    VALUES (1, ?)
                `;

                db.query(insertStreakQuery, [student_id], (err, result) => {
                    if (err) {
                        console.error('Error inserting new streak:', err);
                        return reject({ message: 'Failed to add streak' });
                    }

                    // Log the streak value after insertion
                    db.query(getCurrentStreakQuery, [student_id], (err, finalStreaks) => {
                        if (err) {
                            console.error('Error fetching final streak after insertion:', err);
                            return reject({ message: 'Failed to fetch final streak after insertion' });
                        }

                        console.log('Final streak query result after insertion:', finalStreaks);
                        resolve({ streakValue: 1 });
                    });
                });
            }
        });
    });
};




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
                res.status(401).json({ message: 'Incorrect current password. Try again.' });
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

    const staffId = req.params.staff_id;
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

    // Get today's date and yesterday's date
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const formatDate = (date) => date.toISOString().split('T')[0];


    // Query to check if there is a record for today
    const checkTodayQuery = `
        SELECT COUNT(*) as count FROM daily_record 
        WHERE student_id = ? 
        AND DATE(daily_record_timestamp) = ?
    `;

    db.query(checkTodayQuery, [studentId, formatDate(today)], (err, results) => {
        if (err) {
            console.error('Error checking today\'s record:', err);
            return res.status(500).json({ message: 'Failed to check today\'s record' });
        }

        const loggedToday = results[0].count > 0;

        if (loggedToday) {
            // If user has logged today, do not reset the streak
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
                    return res.json({ streakValue: 1 }); // If the streak table somehow doesn't have an entry, assume they start at 1
                }
            });
        } else {
            // Otherwise, check if there was a record yesterday
            const checkYesterdayQuery = `
                SELECT COUNT(*) as count FROM daily_record 
                WHERE student_id = ? 
                AND DATE(daily_record_timestamp) = ?
            `;

            db.query(checkYesterdayQuery, [studentId, formatDate(yesterday)], (err, results) => {
                if (err) {
                    console.error('Error checking yesterday\'s record:', err);
                    return res.status(500).json({ message: 'Failed to check yesterday\'s record' });
                }

                const recordExists = results[0].count > 0;

                if (recordExists) {
                    // If there was a record yesterday, return the current streak
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
                } else {
                    // If there was no record yesterday, reset the streak to 0
                    console.log('No record for yesterday. Resetting streak.');
                    const resetStreakQuery = `UPDATE streak SET streak_value = 0 WHERE student_id = ?`;

                    db.query(resetStreakQuery, [studentId], (err) => {
                        if (err) {
                            console.error('Error resetting streak:', err);
                            return res.status(500).json({ message: 'Failed to reset streak' });
                        }

                        return res.json({ streakValue: 0 });
                    });
                }
            });
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
    // Inside verifyTokenStudent middleware
    console.log('Student ID:', req.user.student_id);

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

        console.log('Last Submission Results:', results);

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

app.get('/api/quick-track/cooldown/:student_id', verifyTokenStudent, (req, res) => {
    const studentId = req.user.student_id;

    const checkLastSubmissionQuery = `
        SELECT quick_track_timestamp 
        FROM quick_track 
        WHERE student_id = ? 
        ORDER BY quick_track_timestamp DESC 
        LIMIT 1
    `;

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
                return res.json({
                    cooldownActive: true,
                    remainingTimeSeconds: remainingSeconds
                });
            }
        }

        res.json({ cooldownActive: false });
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
            SELECT dr.daily_record_timestamp AS record_timestamp, m.mood_score, s.socialisation_score, e.exercise_score, sl.sleep_score 
        FROM daily_record dr 
        JOIN moods m ON m.mood_id = dr.mood_id
        JOIN socialisation s ON s.socialisation_id = dr.socialisation_id
        JOIN exercise e ON e.exercise_id = dr.exercise_id
        JOIN sleep sl ON sl.sleep_id = dr.sleep_id
        WHERE dr.student_id = ?

        UNION ALL

        SELECT qt.quick_track_timestamp AS record_timestamp, m.mood_score, NULL AS socialisation_score, NULL AS exercise_score, NULL AS sleep_score 
        FROM quick_track qt
        JOIN moods m ON m.mood_id = qt.mood_id
        WHERE qt.student_id = ?

        ORDER BY record_timestamp DESC;
        `;

    db.query(getRecordsQuery, [studentId, studentId], (err, records) => {
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
        SELECT m.mood_score, m.mood_name, combined.record_timestamp
        FROM (
            SELECT dr.daily_record_timestamp as record_timestamp, dr.mood_id
            FROM daily_record dr
            WHERE dr.student_id = ?

            UNION ALL

            SELECT qt.quick_track_timestamp as record_timestamp, qt.mood_id
            FROM quick_track qt
            WHERE qt.student_id = ?
        ) as combined
        JOIN moods m ON m.mood_id = combined.mood_id
        ORDER BY combined.record_timestamp ASC
    `;

    db.query(getMoodScoresQuery, [studentId, studentId], (err, results) => {
        if (err) {
            console.error('Error fetching mood scores:', err);
            return res.status(500).json({ message: 'Failed to fetch mood scores' });
        }

        return res.json({ moodScores: results });
    });
});

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
        SELECT dr.daily_record_timestamp, dr.sleep_id, s.sleep_score 
        FROM daily_record dr
        JOIN sleep s ON s.sleep_id = dr.sleep_id
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
    // console.log(`Fetching stats for student ID: ${studentId}`);

    const today = new Date();

    const query = `
      SELECT
    DATE(record_date) AS date,
    ROUND(AVG(mood_score), 1) AS avg_mood,
    ROUND(AVG(exercise_score), 1) AS avg_exercise,
    ROUND(AVG(sleep_score), 1) AS avg_sleep,
    ROUND(AVG(socialisation_score), 1) AS avg_socialisation,
    ROUND(AVG(productivity_score), 1) AS avg_productivity
FROM (
    SELECT
        dr.daily_record_timestamp AS record_date,
        COALESCE(m.mood_score, 0) AS mood_score,
        COALESCE(e.exercise_score, 0) AS exercise_score,
        COALESCE(sl.sleep_score, 0) AS sleep_score,
        COALESCE(s.socialisation_score, 0) AS socialisation_score,
        COALESCE(dr.productivity_score, 0) AS productivity_score
    FROM daily_record dr
    JOIN moods m ON m.mood_id = dr.mood_id
    JOIN exercise e ON e.exercise_id = dr.exercise_id
    JOIN sleep sl ON sl.sleep_id = dr.sleep_id
    JOIN socialisation s ON s.socialisation_id = dr.socialisation_id
    WHERE dr.student_id = ?

    UNION ALL

    SELECT
        qt.quick_track_timestamp AS record_date,
        COALESCE(m.mood_score, 0) AS mood_score,
        NULL AS exercise_score,
        NULL AS sleep_score,
        NULL AS socialisation_score,
        NULL AS productivity_score
    FROM quick_track qt
    JOIN moods m ON m.mood_id = qt.mood_id
    WHERE qt.student_id = ?
) AS combined
WHERE record_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
GROUP BY date
ORDER BY date ASC
    `;

    db.query(query, [studentId, studentId], (err, results) => {
        if (err) {
            console.error('Error fetching stats:', err);
            return res.status(500).json({ message: 'Failed to fetch stats' });
        }

        // console.log('SQL Query Results:', results);

        // Handling today's records
        const today = new Date();
        const todayRecord = results.find(record => {
            const recordDate = new Date(record.date);
            return (
                recordDate.getDate() === today.getDate() &&
                recordDate.getMonth() === today.getMonth() &&
                recordDate.getFullYear() === today.getFullYear()
            );
        }) || {
            avg_mood: '-',
            avg_exercise: '-',
            avg_sleep: '-',
            avg_socialisation: '-',
            avg_productivity: '-',
        };


        // Calculating 7-day averages
        const calculateAverage = (data, key) => {
            if (data.length === 0) {
                return '-';
            }
            const validEntries = data.filter(record => record[key] !== null);
            if (validEntries.length === 0) {
                return '-';
            }
            const sum = validEntries.reduce((acc, record) => acc + parseFloat(record[key]), 0);
            const average = (sum / validEntries.length).toFixed(1);

            return average;
        };

        const averages = {
            mood: calculateAverage(results, 'avg_mood'),
            exercise: calculateAverage(results, 'avg_exercise'),
            sleep: calculateAverage(results, 'avg_sleep'),
            socialisation: calculateAverage(results, 'avg_socialisation'),
            productivity: calculateAverage(results, 'avg_productivity'),
        };

        // Calculating trends based on today's values compared to the 7-day averages
        const trends = {
            mood: todayRecord.avg_mood !== '-' ? parseFloat(todayRecord.avg_mood) - parseFloat(averages.mood) : 0,
            exercise: todayRecord.avg_exercise !== '-' ? parseFloat(todayRecord.avg_exercise) - parseFloat(averages.exercise) : 0,
            sleep: todayRecord.avg_sleep !== '-' ? parseFloat(todayRecord.avg_sleep) - parseFloat(averages.sleep) : 0,
            socialisation: todayRecord.avg_socialisation !== '-' ? parseFloat(todayRecord.avg_socialisation) - parseFloat(averages.socialisation) : 0,
            productivity: todayRecord.avg_productivity !== '-' ? parseFloat(todayRecord.avg_productivity) - parseFloat(averages.productivity) : 0,
        };

        const stats = {
            today: {
                mood: todayRecord.avg_mood,
                exercise: todayRecord.avg_exercise,
                sleep: todayRecord.avg_sleep,
                socialisation: todayRecord.avg_socialisation,
                productivity: todayRecord.avg_productivity,
            },
            averages: averages,
            trends: trends,
        };

        // console.log('Stats:', stats);
        res.json({ stats });
    });
});

app.get('/api/students', verifyTokenStaff, async (req, res) => {
    try {
        const { course_name, academic_year, search, sort_by, order } = req.query;

        let whereClauses = [];
        let orderByClause = '';

        // Add filters
        if (course_name) {
            whereClauses.push(`c.course_name = ${db.escape(course_name)}`);
        }
        if (academic_year) {
            whereClauses.push(`ay.academic_year_name = ${db.escape(academic_year)}`);
        }
        if (search) {
            whereClauses.push(`
                (s.student_name LIKE ${db.escape('%' + search + '%')} 
                OR s.student_number LIKE ${db.escape('%' + search + '%')}
                OR c.course_name LIKE ${db.escape('%' + search + '%')}
                OR ay.academic_year_name LIKE ${db.escape('%' + search + '%')})
            `);
        }

        // Add sorting
        if (sort_by) {
            orderByClause = `ORDER BY ${sort_by}`;
            if (order && (order === 'asc' || order === 'desc')) {
                orderByClause += ` ${order.toUpperCase()}`;
            }
        }

        // Build the query
        const studentsQuery = `
            SELECT 
                s.student_id, 
                s.student_name, 
                s.student_number, 
                COALESCE(MAX(dr.daily_record_timestamp), MAX(qt.quick_track_timestamp)) AS last_recording_date,
                c.course_name,
                ay.academic_year_name
            FROM student s
            LEFT JOIN daily_record dr ON s.student_id = dr.student_id
            LEFT JOIN quick_track qt ON s.student_id = qt.student_id
            LEFT JOIN course c ON s.course_id = c.course_id
            LEFT JOIN academic_year ay ON s.course_year_id = ay.academic_year_id
            ${whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : ''}
            GROUP BY s.student_id
            ${orderByClause}
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
            const moodAverage = stats.length === 0 ? null : stats.reduce((acc, curr) => acc + curr.mood_score, 0) / stats.length;

            return { studentId: student.student_id, moodTrend, moodAverage };
        }));

        const studentsWithMood = students.map((student) => {
            const moodData = moodTrends.find((trend) => trend.studentId === student.student_id);
            return {
                ...student, moodTrend: moodData?.moodTrend || 'no record',
                moodAverage: moodData?.moodAverage || 'no record'
            };
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
        JOIN student st ON st.student_id = dr.student_id
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
        conditions += ` AND st.course_year_id IN (${academicYear.split(',').map(year => `'${year}'`).join(',')})`;
    }
    if (course) {
        conditions += ` AND st.course_id IN (${course.split(',').map(courseId => `'${courseId}'`).join(',')})`;
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
    const { resource_name, resource_link, resource_topic_id } = req.body;
    db.query('UPDATE resources SET resource_name = ?, resource_link = ?, resource_topic_id = ? WHERE resource_id = ?', [resource_name, resource_link, resource_topic_id, resource_id], (err) => {
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

// app.get('/api/recommended-resources/:student_id', verifyTokenStudent, async (req, res) => {
//     const studentId = req.params.student_id;

//     try {
//         const threeDaysAgo = new Date();
//         threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
//         const formattedDate = threeDaysAgo.toISOString().split('T')[0];

//         const query = `
//             SELECT 
//                 r.resource_name, r.resource_link, rt.resource_topic_name, dr.daily_record_timestamp
//             FROM 
//                 daily_record dr
//             JOIN 
//                 resources r ON r.resource_topic_id = (
//                     CASE 
//                         WHEN dr.mood_id IN (SELECT mood_id FROM moods WHERE mood_score < 5) THEN 1 -- Assuming 1 is the topic ID for mood resources
//                         WHEN dr.exercise_id IN (SELECT exercise_id FROM exercise WHERE exercise_score < 5) THEN 2 -- Assuming 2 is the topic ID for exercise resources
//                         -- Add more cases as needed
//                     END
//                 )
//             JOIN 
//                 resource_topic rt ON rt.resource_topic_id = r.resource_topic_id
//             WHERE 
//                 dr.student_id = ? AND DATE(dr.daily_record_timestamp) >= ?
//             ORDER BY 
//                 dr.daily_record_timestamp DESC
//             LIMIT 3;
//         `;

//         const [resources] = await db.promise().query(query, [studentId, formattedDate]);

//         res.json({ resources });
//     } catch (error) {
//         console.error('Error fetching recommended resources:', error);
//         res.status(500).json({ message: 'Failed to fetch recommended resources' });
//     }
// });

app.get('/api/personalised-resources/:student_id', verifyTokenStudent, async (req, res) => {
    const studentId = req.params.student_id;

    try {
        // Calculate the 3-day average for each metric
        const threeDayAvgQuery = `
            SELECT
                AVG(m.mood_score) AS avg_mood,
                AVG(e.exercise_score) AS avg_exercise,
                AVG(sl.sleep_score) AS avg_sleep,
                AVG(s.socialisation_score) AS avg_socialisation,
                AVG(dr.productivity_score) AS avg_productivity
            FROM daily_record dr
            JOIN moods m ON dr.mood_id = m.mood_id
            JOIN exercise e ON dr.exercise_id = e.exercise_id
            JOIN sleep sl ON dr.sleep_id = sl.sleep_id
            JOIN socialisation s ON dr.socialisation_id = s.socialisation_id
            WHERE dr.student_id = ? AND dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)
            GROUP BY dr.student_id;
        `;

        const [avgResults] = await db.promise().query(threeDayAvgQuery, [studentId]);
        const averages = avgResults[0];

        // Build the list of topics to query
        const struggles = [];
        if (averages.avg_mood < 2.5) struggles.push('Mood');
        if (averages.avg_exercise < 2.5) struggles.push('Exercise');
        if (averages.avg_sleep < 2.5) struggles.push('Sleep');
        if (averages.avg_socialisation < 2.5) struggles.push('Socialisation');
        if (averages.avg_productivity < 2.5) struggles.push('Productivity');

        console.log('Average Mood: ', averages.avg_mood);
        console.log('Average Exercise: ', averages.avg_exercise);
        console.log('Average Sleep: ', averages.avg_sleep);
        console.log('Average Socialisation: ', averages.avg_socialisation);
        console.log('Average Productivity: ', averages.avg_productivity);
        // Check for specific tags logged more than 2 times in the last 5 days
        const tagsQuery = `
            SELECT t.tag_name
            FROM daily_record_tag drt
            JOIN tag t ON drt.tag_id = t.tag_id
            JOIN daily_record dr ON dr.daily_record_id = drt.daily_record_id
            WHERE dr.student_id = ? AND dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 5 DAY)
            GROUP BY t.tag_name
            HAVING COUNT(*) >= 2;
        `;

        const [tagsResults] = await db.promise().query(tagsQuery, [studentId]);
        const frequentTags = tagsResults.map(row => row.tag_name);

        const topics = [...struggles, ...frequentTags];

        if (topics.length === 0) {
            return res.json({ message: '', recommendedResources: [] });
        }

        // Select only the first 3 topics
        const selectedTopics = topics.slice(0, 3);

        // Construct the message
        let message = 'We can see you are struggling with ';
        if (selectedTopics.length === 1) {
            message += `${selectedTopics[0]}. Here are some recommended resources to help:`;
        } else if (selectedTopics.length === 2) {
            message += `${selectedTopics[0]} and ${selectedTopics[1]}. Here are some recommended resources to help:`;
        } else {
            message += `${selectedTopics[0]}, ${selectedTopics[1]}, and ${selectedTopics[2]}. Here are some recommended resources to help:`;
        }

        // Prepare and execute the resource query
        const resourceQuery = `
            SELECT r.resource_name, r.resource_link, rt.resource_topic_name
            FROM resources r
            JOIN resource_topic rt ON rt.resource_topic_id = r.resource_topic_id
            WHERE rt.resource_topic_name IN (${selectedTopics.map(() => '?').join(', ')})
        `;
        const [resources] = await db.promise().query(resourceQuery, selectedTopics);

        res.json({ message, recommendedResources: resources });
    } catch (error) {
        console.error('Error fetching personalised resources:', error);
        res.status(500).json({ message: 'Failed to fetch personalised resources' });
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

app.post('/api/contact-staff', verifyTokenStudent, async (req, res) => {
    const { subject, message } = req.body;

    const staffQuery = 'SELECT staff_name, staff_email FROM staff';
    db.query(staffQuery, async (err, results) => {
        if (err) {
            console.error('Error fetching staff emails:', err);
            return res.status(500).json({ message: 'Failed to fetch staff emails' });
        }

        for (const staff of results) {
            const { staff_name, staff_email } = staff;
            const emailMessage = `Hi ${staff_name},\n\n${message}`;
            const emailHtml = `<p>Hi ${staff_name},</p><p>${message}</p>`;

            sendEmail(staff_email, subject, emailMessage, emailHtml);
        }

        res.json({ message: 'Emails sent successfully' });
    });
});

app.get('/api/student-profile/:student_id', verifyTokenStaff, async (req, res) => {
    const studentId = req.params.student_id;

    try {
        // Query to fetch student details, the next assignment's deadline, and the last assignment's deadline
        const studentQuery = `
            SELECT 
                s.student_name, 
                s.student_email, 
                s.student_number, 
                c.course_name, 
                ay.academic_year_name,
                COALESCE(MAX(dr.daily_record_timestamp), MAX(qt.quick_track_timestamp)) AS last_recording_date,
                (SELECT MIN(a.assignment_deadline) 
                 FROM assignment a 
                 WHERE a.student_id = s.student_id 
                 AND a.assignment_deadline >= CURDATE()) AS next_assignment_deadline,
                (SELECT MAX(a.assignment_deadline) 
                 FROM assignment a 
                 WHERE a.student_id = s.student_id 
                 AND a.assignment_deadline < CURDATE()) AS last_assignment_deadline
            FROM student s
            LEFT JOIN daily_record dr ON s.student_id = dr.student_id
            LEFT JOIN quick_track qt ON s.student_id = qt.student_id
            LEFT JOIN course c ON s.course_id = c.course_id
            LEFT JOIN academic_year ay ON s.course_year_id = ay.academic_year_id
            WHERE s.student_id = ?
            GROUP BY s.student_id
        `;

        // Query to fetch last 30 days data and 7-day averages
        const metricsQuery = `
        SELECT 
            DATE(dr.daily_record_timestamp) AS date,
            ROUND(AVG(m.mood_score), 1) AS avg_mood,
            ROUND(AVG(e.exercise_score), 1) AS avg_exercise,
            ROUND(AVG(sl.sleep_score), 1) AS avg_sleep,
            ROUND(AVG(social.socialisation_score), 1) AS avg_socialisation,
            ROUND(AVG(dr.productivity_score), 1) AS avg_productivity,
            ROUND(AVG(
                (SELECT AVG(m2.mood_score)
                FROM daily_record dr2
                LEFT JOIN moods m2 ON dr2.mood_id = m2.mood_id
                WHERE dr2.student_id = dr.student_id
                AND DATE(dr2.daily_record_timestamp) BETWEEN DATE(dr.daily_record_timestamp) - INTERVAL 6 DAY AND DATE(dr.daily_record_timestamp))
            ), 1) AS avg_mood_7_day,
            ROUND(AVG(
                (SELECT AVG(e2.exercise_score)
                FROM daily_record dr2
                LEFT JOIN exercise e2 ON dr2.exercise_id = e2.exercise_id
                WHERE dr2.student_id = dr.student_id
                AND DATE(dr2.daily_record_timestamp) BETWEEN DATE(dr.daily_record_timestamp) - INTERVAL 6 DAY AND DATE(dr.daily_record_timestamp))
            ), 1) AS avg_exercise_7_day,
            ROUND(AVG(
                (SELECT AVG(sl2.sleep_score)
                FROM daily_record dr2
                LEFT JOIN sleep sl2 ON dr2.sleep_id = sl2.sleep_id
                WHERE dr2.student_id = dr.student_id
                AND DATE(dr2.daily_record_timestamp) BETWEEN DATE(dr.daily_record_timestamp) - INTERVAL 6 DAY AND DATE(dr.daily_record_timestamp))
            ), 1) AS avg_sleep_7_day,
            ROUND(AVG(
                (SELECT AVG(social2.socialisation_score)
                FROM daily_record dr2
                LEFT JOIN socialisation social2 ON dr2.socialisation_id = social2.socialisation_id
                WHERE dr2.student_id = dr.student_id
                AND DATE(dr2.daily_record_timestamp) BETWEEN DATE(dr.daily_record_timestamp) - INTERVAL 6 DAY AND DATE(dr.daily_record_timestamp))
            ), 1) AS avg_socialisation_7_day,
            ROUND(AVG(
                (SELECT AVG(dr2.productivity_score)
                FROM daily_record dr2
                WHERE dr2.student_id = dr.student_id
                AND DATE(dr2.daily_record_timestamp) BETWEEN DATE(dr.daily_record_timestamp) - INTERVAL 6 DAY AND DATE(dr.daily_record_timestamp))
            ), 1) AS avg_productivity_7_day
        FROM daily_record dr
        LEFT JOIN moods m ON dr.mood_id = m.mood_id
        LEFT JOIN exercise e ON dr.exercise_id = e.exercise_id
        LEFT JOIN sleep sl ON dr.sleep_id = sl.sleep_id
        LEFT JOIN socialisation social ON dr.socialisation_id = social.socialisation_id
        WHERE dr.student_id = ? 
        AND dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        GROUP BY DATE(dr.daily_record_timestamp), dr.student_id
        ORDER BY DATE(dr.daily_record_timestamp) ASC
    `;


        const [metrics] = await db.promise().query(metricsQuery, [studentId]);
        const [student] = await db.promise().query(studentQuery, [studentId]);

        console.log('metrics:', metrics);
        if (student.length === 0) {
            return res.status(404).json({ message: 'Student not found' });
        }

        // Assuming metrics might be empty
        if (metrics.length > 0) {
            student[0].avg_mood_7_day = metrics[metrics.length - 1].avg_mood_7_day || null;
            student[0].avg_exercise_7_day = metrics[metrics.length - 1].avg_exercise_7_day || null;
            student[0].avg_sleep_7_day = metrics[metrics.length - 1].avg_sleep_7_day || null;
            student[0].avg_socialisation_7_day = metrics[metrics.length - 1].avg_socialisation_7_day || null;
            student[0].avg_productivity_7_day = metrics[metrics.length - 1].avg_productivity_7_day || null;
        }

        res.json({
            ...student[0],
            metrics, // Include the metrics data in the response
        });
    } catch (error) {
        console.error('Error fetching student profile:', error);
        res.status(500).json({ message: 'Failed to fetch student profile' });
    }
});




app.get('/api/weekly-averages', verifyTokenStaff, async (req, res) => {
    try {
        // Query to get averages by academic year
        const yearQuery = `
  SELECT combined.academic_year_name,
                   AVG(combined.mood_score) as avg_mood,
                   AVG(combined.exercise_score) as avg_exercise,
                   AVG(combined.sleep_score) as avg_sleep,
                   AVG(combined.socialisation_score) as avg_socialisation,
                   AVG(combined.productivity_score) as avg_productivity
            FROM (
                SELECT dr.daily_record_timestamp as record_date,
                       m.mood_score,
                       e.exercise_score,
                       sl.sleep_score,
                       s.socialisation_score,
                       dr.productivity_score,
                       ay.academic_year_name
                FROM daily_record dr
                JOIN student st ON st.student_id = dr.student_id
                JOIN academic_year ay ON ay.academic_year_id = st.course_year_id
                JOIN moods m ON dr.mood_id = m.mood_id
                JOIN socialisation s ON dr.socialisation_id = s.socialisation_id
                JOIN exercise e ON dr.exercise_id = e.exercise_id
                JOIN sleep sl ON dr.sleep_id = sl.sleep_id
                WHERE dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)

                UNION ALL

                SELECT qt.quick_track_timestamp as record_date,
                       m.mood_score,
                       NULL as exercise_score,
                       NULL as sleep_score,
                       NULL as socialisation_score,
                       NULL as productivity_score,
                       ay.academic_year_name
                FROM quick_track qt
                JOIN student st ON st.student_id = qt.student_id
                JOIN academic_year ay ON ay.academic_year_id = st.course_year_id
                JOIN moods m ON qt.mood_id = m.mood_id
                WHERE qt.quick_track_timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            ) as combined
            GROUP BY combined.academic_year_name
            ORDER BY combined.academic_year_name
        `;

        // Query to get averages by course
        const courseQuery = `
        SELECT combined.course_name,
                   AVG(combined.mood_score) as avg_mood,
                   AVG(combined.exercise_score) as avg_exercise,
                   AVG(combined.sleep_score) as avg_sleep,
                   AVG(combined.socialisation_score) as avg_socialisation,
                   AVG(combined.productivity_score) as avg_productivity
            FROM (
                SELECT dr.daily_record_timestamp as record_date,
                       m.mood_score,
                       e.exercise_score,
                       sl.sleep_score,
                       s.socialisation_score,
                       dr.productivity_score,
                       c.course_name
                FROM daily_record dr
                JOIN student st ON st.student_id = dr.student_id
                JOIN course c ON c.course_id = st.course_id
                JOIN moods m ON dr.mood_id = m.mood_id
                JOIN socialisation s ON dr.socialisation_id = s.socialisation_id
                JOIN exercise e ON dr.exercise_id = e.exercise_id
                JOIN sleep sl ON dr.sleep_id = sl.sleep_id
                WHERE dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)

                UNION ALL

                SELECT qt.quick_track_timestamp as record_date,
                       m.mood_score,
                       NULL as exercise_score,
                       NULL as sleep_score,
                       NULL as socialisation_score,
                       NULL as productivity_score,
                       c.course_name
                FROM quick_track qt
                JOIN student st ON st.student_id = qt.student_id
                JOIN course c ON c.course_id = st.course_id
                JOIN moods m ON qt.mood_id = m.mood_id
                WHERE qt.quick_track_timestamp >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
            ) as combined
            GROUP BY combined.course_name
            ORDER BY combined.course_name
        `;

        // Execute both queries in parallel
        const [yearResults, courseResults] = await Promise.all([
            new Promise((resolve, reject) => {
                db.query(yearQuery, (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            }),
            new Promise((resolve, reject) => {
                db.query(courseQuery, (err, results) => {
                    if (err) reject(err);
                    else resolve(results);
                });
            }),
        ]);

        // Send the combined response
        res.json({
            yearAverages: yearResults,
            courseAverages: courseResults,
        });

    } catch (error) {
        console.error('Error fetching weekly averages:', error);
        res.status(500).json({ message: 'Failed to fetch weekly averages' });
    }
});

app.get('/api/export-dailytrack-csv', verifyTokenStaff, async (req, res) => {
    try {
        const query = `
            SELECT 
                dr.daily_record_timestamp AS 'Time', 
                s.student_number AS 'Student Number', 
                s.student_name AS 'Name', 
                s.date_of_birth AS 'Date of Birth', 
                e.exercise_name AS 'Exercise Length', 
                e.exercise_score AS 'Exercise Score', 
                m.mood_name AS 'Mood', 
                m.mood_score AS 'Mood Score', 
                so.socialisation_name AS 'Socialisation Name', 
                so.socialisation_score AS 'Socialisation Score', 
                GROUP_CONCAT(t.tag_name SEPARATOR '; ') AS 'Tags'
            FROM daily_record dr 
            LEFT JOIN student s ON s.student_id = dr.student_id
            LEFT JOIN daily_record_tag drt ON drt.daily_record_id = dr.daily_record_id
            LEFT JOIN exercise e ON e.exercise_id = dr.exercise_id
            LEFT JOIN moods m ON dr.mood_id = m.mood_id
            LEFT JOIN sleep sl ON sl.sleep_id = dr.sleep_id
            LEFT JOIN socialisation so ON so.socialisation_id = dr.socialisation_id 
            LEFT JOIN tag t ON t.tag_id = drt.tag_id
            GROUP BY dr.daily_record_timestamp, s.student_number, s.student_name, s.date_of_birth, 
                     e.exercise_name, e.exercise_score, m.mood_name, m.mood_score, 
                     so.socialisation_name, so.socialisation_score;
        `;

        db.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching daily track data:', err);
                return res.status(500).json({ message: 'Failed to fetch data' });
            }

            // Convert the results to CSV
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(results);

            // Generate the filename with the current date and time
            const currentDateTime = moment().format('YYYYMMDD_HHmmss');
            const filename = `DailyTrack_${currentDateTime}.csv`;

            // Set the response headers to trigger a file download
            res.header('Content-Type', 'text/csv');
            res.attachment(filename);
            res.send(csv);
        });
    } catch (error) {
        console.error('Error exporting daily track data:', error);
        res.status(500).json({ message: 'Failed to export data' });
    }
});

app.get('/api/export-studentlist-csv', verifyTokenStaff, async (req, res) => {
    try {
        const query = `
            SELECT  
                s.student_number AS 'Student Number', 
                s.student_name AS 'Name', 
                s.date_of_birth AS 'Date of Birth', 
                s.student_email AS 'Email Address', 
                c.course_name AS 'Course', 
                ay.academic_year_name AS 'Year Group', 
                GROUP_CONCAT(CONCAT(a.assignment_name, ' (Due: ', DATE_FORMAT(a.assignment_deadline, '%Y-%m-%d'), ')') SEPARATOR '; ') AS 'Assignments'
            FROM student s 
            LEFT JOIN academic_year ay ON s.course_year_id = ay.academic_year_id
            LEFT JOIN assignment a ON a.student_id = s.student_id
            LEFT JOIN course c ON c.course_id = s.course_id
            LEFT JOIN streak st ON st.student_id = s.student_id
            GROUP BY s.student_id, s.student_number, s.student_name, s.date_of_birth, s.student_email, c.course_name, ay.academic_year_name;
        `;

        db.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching student list:', err);
                return res.status(500).json({ message: 'Failed to fetch data' });
            }

            // Convert the results to CSV
            const json2csvParser = new Parser();
            const csv = json2csvParser.parse(results);

            // Generate the filename with the current date and time
            const currentDateTime = moment().format('YYYYMMDD_HHmmss');
            const filename = `StudentList_${currentDateTime}.csv`;

            // Set the response headers to trigger a file download
            res.header('Content-Type', 'text/csv');
            res.attachment(filename);
            res.send(csv);
        });
    } catch (error) {
        console.error('Error exporting student list:', error);
        res.status(500).json({ message: 'Failed to export data' });
    }
});

app.get('/api/student-insights/:student_id', verifyTokenStudent, async (req, res) => {
    const studentId = req.params.student_id;

    try {
        // Calculate the start and end dates for the current and previous weeks
        const endOfCurrentWeek = new Date();
        const startOfCurrentWeek = new Date();
        startOfCurrentWeek.setDate(endOfCurrentWeek.getDate() - 6);

        const endOfPreviousWeek = new Date(startOfCurrentWeek);
        endOfPreviousWeek.setDate(startOfCurrentWeek.getDate() - 1);
        const startOfPreviousWeek = new Date(endOfPreviousWeek);
        startOfPreviousWeek.setDate(endOfPreviousWeek.getDate() - 6);

        // Format dates for SQL queries
        const formatDate = (date) => date.toISOString().split('T')[0];

        // Fetch records for the current week
        const currentWeekQuery = `
            SELECT 
                combined.record_date, 
                combined.mood_score, 
                combined.exercise_score, 
                combined.sleep_score, 
                combined.socialisation_score, 
                combined.productivity_score
            FROM (
                SELECT 
                    dr.daily_record_timestamp as record_date,
                    m.mood_score,
                    e.exercise_score,
                    sl.sleep_score,
                    s.socialisation_score,
                    dr.productivity_score
                FROM daily_record dr
                JOIN moods m ON dr.mood_id = m.mood_id
                JOIN exercise e ON dr.exercise_id = e.exercise_id
                JOIN sleep sl ON dr.sleep_id = sl.sleep_id
                JOIN socialisation s ON dr.socialisation_id = s.socialisation_id
                WHERE dr.student_id = ? 
                AND dr.daily_record_timestamp BETWEEN ? AND ?
                
                UNION ALL
                
                SELECT 
                    qt.quick_track_timestamp as record_date,
                    m.mood_score,
                    NULL as exercise_score,
                    NULL as sleep_score,
                    NULL as socialisation_score,
                    NULL as productivity_score
                FROM quick_track qt
                JOIN moods m ON qt.mood_id = m.mood_id
                WHERE qt.student_id = ?
                AND qt.quick_track_timestamp BETWEEN ? AND ?
            ) as combined
            ORDER BY combined.record_date DESC;
        `;
        const [currentWeekRecords] = await db.promise().query(currentWeekQuery, [studentId, formatDate(startOfCurrentWeek), formatDate(endOfCurrentWeek), studentId, formatDate(startOfCurrentWeek), formatDate(endOfCurrentWeek)]);

        // Fetch records for the previous week
        const previousWeekQuery = `
    SELECT 
                combined.record_date, 
                combined.mood_score, 
                combined.exercise_score, 
                combined.sleep_score, 
                combined.socialisation_score, 
                combined.productivity_score
            FROM (
                SELECT 
                    dr.daily_record_timestamp as record_date,
                    m.mood_score,
                    e.exercise_score,
                    sl.sleep_score,
                    s.socialisation_score,
                    dr.productivity_score
                FROM daily_record dr
                JOIN moods m ON dr.mood_id = m.mood_id
                JOIN exercise e ON dr.exercise_id = e.exercise_id
                JOIN sleep sl ON dr.sleep_id = sl.sleep_id
                JOIN socialisation s ON dr.socialisation_id = s.socialisation_id
                WHERE dr.student_id = ? 
                AND dr.daily_record_timestamp BETWEEN ? AND ?

                UNION ALL
                
                SELECT 
                    qt.quick_track_timestamp as record_date,
                    m.mood_score,
                    NULL as exercise_score,
                    NULL as sleep_score,
                    NULL as socialisation_score,
                    NULL as productivity_score
                FROM quick_track qt
                JOIN moods m ON qt.mood_id = m.mood_id
                WHERE qt.student_id = ?
                AND qt.quick_track_timestamp BETWEEN ? AND ?
            ) as combined
            ORDER BY combined.record_date DESC;
        `;
        const [previousWeekRecords] = await db.promise().query(previousWeekQuery, [studentId, formatDate(startOfPreviousWeek), formatDate(endOfPreviousWeek), studentId, formatDate(startOfPreviousWeek), formatDate(endOfPreviousWeek)]);

        let insights = [];

        // Ensure both weeks have data
        if (currentWeekRecords.length > 0 && previousWeekRecords.length > 0) {
            const calculateAverage = (records, key) => {
                return records.reduce((sum, record) => sum + record[key], 0) / records.length;
            };

            const averagesCurrentWeek = {
                mood: calculateAverage(currentWeekRecords, 'mood_score'),
                exercise: calculateAverage(currentWeekRecords, 'exercise_score'),
                sleep: calculateAverage(currentWeekRecords, 'sleep_score'),
                socialisation: calculateAverage(currentWeekRecords, 'socialisation_score'),
                productivity: calculateAverage(currentWeekRecords, 'productivity_score')
            };

            const averagesPreviousWeek = {
                mood: calculateAverage(previousWeekRecords, 'mood_score'),
                exercise: calculateAverage(previousWeekRecords, 'exercise_score'),
                sleep: calculateAverage(previousWeekRecords, 'sleep_score'),
                socialisation: calculateAverage(previousWeekRecords, 'socialisation_score'),
                productivity: calculateAverage(previousWeekRecords, 'productivity_score')
            };

            const generateInsight = (metric, label) => {
                if (averagesCurrentWeek[metric] > averagesPreviousWeek[metric]) {
                    insights.push(`Great job! Your ${label} is better this week than last week! Keep it up!`);
                } else if (averagesCurrentWeek[metric] < averagesPreviousWeek[metric]) {
                    insights.push(`Your ${label} has decreased this week compared to last. Consider focusing on improving it.`);
                }
            };

            generateInsight('mood', 'mood');
            generateInsight('exercise', 'exercise');
            generateInsight('sleep', 'sleep quality');
            generateInsight('socialisation', 'socialisation');
            generateInsight('productivity', 'productivity');

            // Calculate correlations
            const sleepMoodCorrelation = analyseCorrelation(currentWeekRecords, 'sleep_score', 'mood_score');
            const exerciseMoodCorrelation = analyseCorrelation(currentWeekRecords, 'exercise_score', 'mood_score');
            const socialisationMoodCorrelation = analyseCorrelation(currentWeekRecords, 'socialisation_score', 'mood_score');
            const moodProductivityCorrelation = analyseCorrelation(currentWeekRecords, 'mood_score', 'productivity_score');
            const sleepProductivityCorrelation = analyseCorrelation(currentWeekRecords, 'sleep_score', 'productivity_score');
            const exerciseProductivityCorrelation = analyseCorrelation(currentWeekRecords, 'exercise_score', 'productivity_score');


            if (sleepMoodCorrelation > 0.5 && averagesCurrentWeek.mood < 3 && averagesCurrentWeek.sleep < 3) {
                insights.push("We've noticed sleep has a positive effect on your mood. Try to get better sleep to improve your mood.");
            }

            if (exerciseMoodCorrelation > 0.5 && averagesCurrentWeek.mood < 3 && averagesCurrentWeek.exercise < 3) {
                insights.push("We've noticed exercise has a positive effect on your mood. Try to fit in some exercise to improve your mood.");
            }

            if (socialisationMoodCorrelation > 0.5 && averagesCurrentWeek.mood < 3 && averagesCurrentWeek.socialisation < 3) {
                insights.push("You are experiencing low mood. Socializing often improves your mood, consider connecting with friends.");
            }

            if (moodProductivityCorrelation > 0.5 && averagesCurrentWeek.productivity < 3 && averagesCurrentWeek.mood < 3) {
                insights.push("Your mood seems to impact your productivity. Improving your mood may help boost your productivity.");
            }

            if (sleepProductivityCorrelation > 0.5 && averagesCurrentWeek.productivity < 3 && averagesCurrentWeek.sleep < 3) {
                insights.push("We've noticed that sleep positively affects your productivity. Better sleep could lead to higher productivity.");
            }

            if (exerciseProductivityCorrelation > 0.5 && averagesCurrentWeek.productivity < 3 && averagesCurrentWeek.exercise < 3) {
                insights.push("Exercise seems to boost your productivity. Incorporating more physical activity could help improve your focus.");
            }
        } else {
            insights.push("Not enough data to generate weekly insights. Please keep tracking your activities.");
        }

        res.json({ insights });
    } catch (error) {
        console.error('Error generating student insights:', error);
        res.status(500).json({ message: 'Failed to generate insights' });
    }
});

// A simple correlation analysis function (example logic)
function analyseCorrelation(records, metric1, metric2) {
    let sumMetric1 = 0, sumMetric2 = 0, sumMetric1Metric2 = 0, sumMetric1Square = 0, sumMetric2Square = 0;
    const n = records.length;

    records.forEach(record => {
        sumMetric1 += record[metric1];
        sumMetric2 += record[metric2];
        sumMetric1Metric2 += record[metric1] * record[metric2];
        sumMetric1Square += record[metric1] * record[metric1];
        sumMetric2Square += record[metric2] * record[metric2];
    });

    const numerator = (n * sumMetric1Metric2) - (sumMetric1 * sumMetric2);
    const denominator = Math.sqrt((n * sumMetric1Square - sumMetric1 * sumMetric1) * (n * sumMetric2Square - sumMetric2 * sumMetric2));

    return denominator !== 0 ? numerator / denominator : 0;
}

app.get('/api/tag-statistics', verifyTokenStaff, async (req, res) => {
    try {
        const query = `
                     SELECT t.tag_name, 
                   COUNT(DISTINCT dr.student_id) AS students_with_tag,
                   (SELECT COUNT(*) FROM student) AS total_students
            FROM daily_record dr
            LEFT JOIN daily_record_tag drt ON drt.daily_record_id = dr.daily_record_id
            LEFT JOIN tag t ON t.tag_id = drt.tag_id
            WHERE dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 1 MONTH)
              AND t.tag_name IS NOT NULL
              AND t.tag_name != ''
            GROUP BY t.tag_name
            HAVING students_with_tag > 0;
            `;

        db.query(query, (err, results) => {
            if (err) {
                console.error('Error fetching tag statistics:', err);
                return res.status(500).json({ message: 'Failed to fetch tag statistics' });
            }

            const tagStatistics = results.map(result => ({
                tagName: result.tag_name,
                percentage: ((result.students_with_tag / result.total_students) * 100).toFixed(2),
            }));

            res.json({ tagStatistics });
        });
    } catch (error) {
        console.error('Error fetching tag statistics:', error);
        res.status(500).json({ message: 'Failed to fetch tag statistics' });
    }
});

app.get('/api/yearly-metrics', verifyTokenStaff, (req, res) => {
    const { academicYear } = req.query;

    const query = `
         SELECT DATE_FORMAT(record_date, '%Y-%m-%d') as date,
               AVG(mood_score) as mood,
               AVG(exercise_score) as exercise,
               AVG(sleep_score) as sleep,
               AVG(socialisation_score) as socialisation,
               AVG(productivity_score) as productivity
        FROM (
             SELECT dr.daily_record_timestamp as record_date,
               m.mood_score,
               e.exercise_score,
               sl.sleep_score,
               s.socialisation_score,
               dr.productivity_score
        FROM daily_record dr
        JOIN student st ON st.student_id = dr.student_id
        JOIN academic_year ay ON ay.academic_year_id= st.course_year_id
        JOIN moods m ON dr.mood_id = m.mood_id
        JOIN socialisation s ON dr.socialisation_id = s.socialisation_id
        JOIN exercise e ON dr.exercise_id = e.exercise_id
        JOIN sleep sl ON dr.sleep_id = sl.sleep_id
        WHERE ay.academic_year_name = ?
       
        UNION ALL

        SELECT qt.quick_track_timestamp as record_date,
               m.mood_score,
               NULL as exercise_score,
               NULL as sleep_score,
               NULL as socialisation_score,
               NULL as productivity_score
        FROM quick_track qt
JOIN student st ON st.student_id = qt.student_id
        JOIN academic_year ay ON ay.academic_year_id= st.course_year_id
        JOIN moods m ON qt.mood_id = m.mood_id
           WHERE ay.academic_year_name = ?
            ) AS combined
    WHERE record_date >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
        GROUP BY date
        ORDER BY date ASC;
    `;

    db.query(query, [academicYear, academicYear], (err, results) => {
        if (err) {
            console.error('Error fetching yearly metrics:', err);
            return res.status(500).json({ message: 'Failed to fetch data' });
        }

        return res.json(results);
    });
});

app.get('/api/course-metrics', verifyTokenStaff, (req, res) => {
    const { courseName } = req.query;

    if (!courseName) {
        return res.status(400).json({ message: 'Course name is required' });
    }

    const query = `
    SELECT DATE_FORMAT(record_date, '%Y-%m-%d') as date,
           AVG(mood_score) as mood,
           AVG(exercise_score) as exercise,
           AVG(sleep_score) as sleep,
           AVG(socialisation_score) as socialisation,
           AVG(productivity_score) as productivity
    FROM (
        SELECT dr.daily_record_timestamp as record_date,
               m.mood_score,
               e.exercise_score,
               sl.sleep_score,
               s.socialisation_score,
               dr.productivity_score
        FROM daily_record dr
        JOIN student st ON st.student_id = dr.student_id
        JOIN course c ON c.course_id = st.course_id
        JOIN moods m ON dr.mood_id = m.mood_id
        JOIN socialisation s ON dr.socialisation_id = s.socialisation_id
        JOIN exercise e ON dr.exercise_id = e.exercise_id
        JOIN sleep sl ON dr.sleep_id = sl.sleep_id
        WHERE c.course_name = ?

        UNION ALL

        SELECT qt.quick_track_timestamp as record_date,
               m.mood_score,
               NULL as exercise_score,
               NULL as sleep_score,
               NULL as socialisation_score,
               NULL as productivity_score
        FROM quick_track qt
        JOIN student st ON st.student_id = qt.student_id
        JOIN course c ON c.course_id = st.course_id
        JOIN moods m ON qt.mood_id = m.mood_id
        WHERE c.course_name = ?
    ) AS combined
    WHERE record_date >= DATE_SUB(CURDATE(), INTERVAL 1 YEAR)
    GROUP BY date
    ORDER BY date ASC;
`;

    db.query(query, [courseName, courseName], (err, results) => {
        if (err) {
            console.error('Error fetching course metrics:', err);
            return res.status(500).json({ message: 'Failed to fetch data' });
        }
        // results.forEach(result => {
        //     console.log(`Date: ${result.date}, Average Mood: ${result.mood}`);
        // });
        return res.json(results);
    });
});

app.get('/api/mood-comparison', verifyTokenStaff, (req, res) => {
    const query = `
        SELECT 
            MONTHNAME(record_date) AS month,
            AVG(CASE WHEN YEAR(record_date) = YEAR(CURDATE()) - 1 THEN mood_score END) AS lastYearMood,
            AVG(CASE WHEN YEAR(record_date) = YEAR(CURDATE()) THEN mood_score END) AS thisYearMood
        FROM (
            SELECT 
                dr.daily_record_timestamp AS record_date,
                m.mood_score
            FROM daily_record dr
            JOIN moods m ON dr.mood_id = m.mood_id
            WHERE YEAR(dr.daily_record_timestamp) IN (YEAR(CURDATE()) - 1, YEAR(CURDATE()))

            UNION ALL

            SELECT 
                qt.quick_track_timestamp AS record_date,
                m.mood_score
            FROM quick_track qt
            JOIN moods m ON qt.mood_id = m.mood_id
            WHERE YEAR(qt.quick_track_timestamp) IN (YEAR(CURDATE()) - 1, YEAR(CURDATE()))
        ) AS combined_data
        GROUP BY MONTH(record_date), MONTHNAME(record_date)
        ORDER BY MONTH(record_date);
    `;

    db.query(query, (err, results) => {
        if (err) {
            console.error('Error fetching mood comparison data:', err);
            return res.status(500).json({ message: 'Failed to fetch mood comparison data' });
        }

        res.json(results);
    });
});

app.get('/api/identify-concerning-cohorts', verifyTokenStaff, async (req, res) => {
    try {
        // Step 1: Identify cohorts with concerning metrics (mood < 3, other metrics < 2)
        const metricsQuery = `
        SELECT 
            s.course_id, 
            s.course_year_id,
            c.course_name,
            ay.academic_year_name,
            AVG(all_data.avg_mood) as avg_mood,
            AVG(all_data.avg_exercise) as avg_exercise,
            AVG(all_data.avg_sleep) as avg_sleep,
            AVG(all_data.avg_socialisation) as avg_socialisation,
            AVG(all_data.avg_productivity) as avg_productivity,
            COUNT(DISTINCT s.student_id) as student_count
        FROM (
            -- Data from daily_record
            SELECT 
                s.course_id,
                s.course_year_id,
                m.mood_score as avg_mood,
                e.exercise_score as avg_exercise,
                sl.sleep_score as avg_sleep,
                soc.socialisation_score as avg_socialisation,
                dr.productivity_score as avg_productivity,
                dr.daily_record_timestamp as timestamp
            FROM daily_record dr
            JOIN student s ON s.student_id = dr.student_id
            JOIN course c ON c.course_id = s.course_id
            JOIN academic_year ay ON ay.academic_year_id = s.course_year_id
            JOIN moods m ON dr.mood_id = m.mood_id
            LEFT JOIN exercise e ON dr.exercise_id = e.exercise_id
            LEFT JOIN sleep sl ON dr.sleep_id = sl.sleep_id
            LEFT JOIN socialisation soc ON dr.socialisation_id = soc.socialisation_id
            WHERE dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
    
            UNION ALL
    
            -- Data from quick_track
            SELECT 
                s.course_id,
                s.course_year_id,
                m.mood_score as avg_mood,
                NULL as avg_exercise, -- No exercise data in quick_track
                NULL as avg_sleep,    -- No sleep data in quick_track
                NULL as avg_socialisation, -- No socialisation data in quick_track
                NULL as avg_productivity, -- No productivity data in quick_track
                qt.quick_track_timestamp as timestamp
            FROM quick_track qt
            JOIN student s ON s.student_id = qt.student_id
            JOIN course c ON c.course_id = s.course_id
            JOIN academic_year ay ON ay.academic_year_id = s.course_year_id
            JOIN moods m ON qt.mood_id = m.mood_id
            WHERE qt.quick_track_timestamp >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        ) as all_data
        JOIN student s ON s.course_id = all_data.course_id AND s.course_year_id = all_data.course_year_id
        JOIN course c ON c.course_id = s.course_id
        JOIN academic_year ay ON ay.academic_year_id = s.course_year_id
        GROUP BY s.course_id, s.course_year_id
        HAVING avg_mood < 2.5
           OR avg_exercise < 2
           OR avg_sleep < 2
           OR avg_socialisation < 2
           OR avg_productivity < 2;
    `;
    
        const [metricsResults] = await db.promise().query(metricsQuery);

        // Step 2: Identify cohorts with tags where 50% or more students have tagged "stressed"
        const tagsQuery = `
        SELECT 
            s.course_id,
            s.course_year_id,
            t.tag_name,
            c.course_name,
            ay.academic_year_name,
            COUNT(DISTINCT s.student_id) as student_count_with_tag,
            (SELECT COUNT(DISTINCT s2.student_id)
             FROM student s2
             WHERE s2.course_id = s.course_id
             AND s2.course_year_id = s.course_year_id) as total_students
        FROM daily_record dr
        JOIN student s ON s.student_id = dr.student_id
        JOIN daily_record_tag drt ON dr.daily_record_id = drt.daily_record_id
        JOIN tag t ON t.tag_id = drt.tag_id
        JOIN course c ON c.course_id = s.course_id
        JOIN academic_year ay ON ay.academic_year_id = s.course_year_id
        WHERE dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
        AND t.tag_name = 'stressed'  -- You can modify this to check for different tags as needed
        GROUP BY s.course_id, s.course_year_id, t.tag_name
        HAVING student_count_with_tag >= (total_students * 0.5);
        `;
        const [tagsResults] = await db.promise().query(tagsQuery);

        // Step 3: Combine the concerning cohorts from both metrics and tags queries
        const concerningCohorts = [];

        // Process results from the concerning metrics query
        metricsResults.forEach(result => {
            const cohort = {
                courseId: result.course_id,
                courseYearId: result.course_year_id,
                courseName: result.course_name,
                academicYear: result.academic_year_name,
                avgMood: result.avg_mood,
                avgExercise: result.avg_exercise,
                avgSleep: result.avg_sleep,
                avgSocialisation: result.avg_socialisation,
                avgProductivity: result.avg_productivity,
                studentCount: result.student_count,
                frequentTags: [],  // No tags yet, just concerning metrics
                earliestAssignment: null,  // Will check for assignments next
            };
            concerningCohorts.push(cohort);
        });

        // Process results from the tags query (add to concerningCohorts if not already included)
        tagsResults.forEach(tagResult => {
            let existingCohort = concerningCohorts.find(cohort => 
                cohort.courseId === tagResult.course_id && cohort.courseYearId === tagResult.course_year_id
            );

            if (existingCohort) {
                // Add tag to existing concerning cohort
                existingCohort.frequentTags.push(tagResult.tag_name);
            } else {
                // If no matching cohort was found, create a new one based on the tag
                concerningCohorts.push({
                    courseId: tagResult.course_id,
                    courseYearId: tagResult.course_year_id,
                    courseName: tagResult.course_name,  // Assuming you can get course_name in the tag query
                    academicYear: tagResult.academic_year_name,  // Assuming this too
                    avgMood: null,  // Not concerning based on metrics
                    avgExercise: null,
                    avgSleep: null,
                    avgSocialisation: null,
                    avgProductivity: null,
                    studentCount: tagResult.total_students,
                    frequentTags: [tagResult.tag_name],
                    earliestAssignment: null,  // Will check for assignments next
                });
            }
        });
        console.log(concerningCohorts);

        // Step 4: For each concerning cohort, check for upcoming assignments
        for (const cohort of concerningCohorts) {
            const assignmentQuery = `
            SELECT MIN(a.assignment_deadline) as earliest_assignment
            FROM assignment a
            JOIN student s ON s.student_id = a.student_id
            WHERE s.course_id = ? AND s.course_year_id = ?
            AND a.assignment_deadline >= CURDATE();
            `;
            const [assignmentResults] = await db.promise().query(assignmentQuery, [cohort.courseId, cohort.courseYearId]);

            if (assignmentResults.length > 0 && assignmentResults[0].earliest_assignment) {
                cohort.earliestAssignment = assignmentResults[0].earliest_assignment;
            }
        }

        // Step 5: Send the combined results back to the client
        res.json({
            isConcerning: concerningCohorts.length > 0,
            concerningCohorts,
        });

    } catch (error) {
        console.error('Error identifying concerning cohorts:', error);
        res.status(500).json({ message: 'Failed to identify concerning cohorts' });
    }
});

app.post('/api/add-course', verifyTokenStaff, (req, res) => {
    const { course_name } = req.body;

    if (!course_name) {
        return res.status(400).json({ message: 'Course name is required' });
    }

    const query = 'INSERT INTO course (course_name) VALUES (?)';

    db.query(query, [course_name], (err, results) => {
        if (err) {
            console.error('Error inserting course:', err);
            return res.status(500).json({ message: 'Failed to add course' });
        }
        res.status(201).json({ message: 'Course added successfully' });
    });
});

app.get('/api/student-aggregated-data/:student_id', verifyTokenStaff, (req, res) => {
    const { metrics } = req.query;
    const { student_id } = req.params;

    let baseQuery = `
        SELECT dr.daily_record_timestamp,
    `;
    let joins = `
        FROM daily_record dr
        JOIN student st ON st.student_id = dr.student_id
    `;
    let conditions = `WHERE st.student_id = ${student_id}`;  // Filter by student_id

    // Map metrics to their corresponding fields
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

    // Finalize the query
    const finalQuery = `${baseQuery.slice(0, -2)} ${joins} ${conditions} ORDER BY dr.daily_record_timestamp ASC`;

    db.query(finalQuery, (err, results) => {
        if (err) {
            console.error('Error fetching student aggregated data:', err);
            return res.status(500).json({ message: 'Failed to fetch student aggregated data' });
        }

        return res.json({ data: results });
    });
});


app.listen(8000, () => {
    console.log('server is running on port 8000')
    db.connect(function (err) {
        if (err) throw err;
        console.log('connected to db');
    })
});