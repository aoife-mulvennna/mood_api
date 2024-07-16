const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
// const mysql = require("mysql2");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const passport = require('passport');
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

// Middleware to verify JWT token
const verifyToken = passport.authenticate('student-jwt', { session: false });
app.use('/api/quick-track', verifyToken);

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
app.post('/api/students', async (req, res) => {
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
        WHERE student_number = ? OR student_email = ?
    `;
    db.query(checkDuplicateQuery, [student_number, student_email], (err, results) => {
        if (err) {
            console.error('Error checking duplicates:', err);
            res.status(500).json({ message: 'Error occurred while checking duplicates' });
            return;
        }

        if (results.length > 0) {
            // Found existing student with same student_number or student_email
            res.status(409).json({ message: 'Student number or email already exists' });
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

                        res.json({ message: 'Account created successfully', student_id: result.insertId });
                    });
                });
            });
        });
    });
});

// app.post('/api/login/student', (req, res) => {
//     //const { studentNumber, student_password } = req.body;
//     const { studentNumber, studentPassword } = req.body;
//     console.log('Login attempt for student number:', studentNumber);
//     // Query to find the user by student number
//     const studentQuery = `SELECT * FROM student WHERE student_number = ?`;

//     db.query(studentQuery, [studentNumber], async (err, studentResults) => {
//         if (err) {
//             console.error('Error fetching student:', err);
//             return res.status(500).send('Error occurred');
//         }
//         if (studentResults.length > 0) {
//             // Found user in student table
//             const student = studentResults[0];
//             console.log('Student found:', student);
//             try {
//                 const passwordMatch = await bcrypt.compare(studentPassword, student.student_password);
//                 if (passwordMatch) {
//                     const token = jwt.sign({ id: student.student_id}, JWT_SECRET, { expiresIn: '1h' });
//                     console.log('Student login successful');
//                     return res.json({ token });
//                 } else {
//                     console.log('Invalid credentials for student');
//                     return res.status(401).send('Invalid credentials');
//                 }
//             } catch (error) {
//                 console.error('Password comparison error:', error);
//                 return res.status(500).send('Error comparing passwords');
//             }
//         } else {
//             console.log('No user found with number:', studentNumber);
//             return res.status(401).send('Invalid credentials');
//         }
//     });
// });
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

// Admin-only route to create staff accounts
// Temporarily removing authentication and admin check for initial staff creation
app.post('/api/staff', async (req, res) => {
    const { staff_number, staff_name, staff_email, staff_password } = req.body;

    if (!staff_email.endsWith('@qub.ac.uk')) {
        return res.status(400).json({ message: 'Please use your QUB email address.' });
    }

    const checkDuplicateQuery = `
        SELECT * FROM staff
        WHERE staff_number = ? OR staff_email = ?
    `;
    db.query(checkDuplicateQuery, [staff_number, staff_email], async (err, results) => {
        if (err) {
            console.error('Error checking duplicates:', err);
            return res.status(500).json({ message: 'Error occurred while checking duplicates' });
        }

        if (results.length > 0) {
            return res.status(409).json({ message: 'Staff number or email already exists' });
        }

        const hashedPassword = await bcrypt.hash(staff_password, 10);

        const insertQuery = `
            INSERT INTO staff (staff_number, staff_name, staff_email, staff_password, role) 
            VALUES (?, ?, ?, ?, 'admin')
        `;
        db.query(insertQuery, [staff_number, staff_name, staff_email, hashedPassword], (err, result) => {
            if (err) {
                console.error('Error inserting staff:', err);
                return res.status(500).json({ message: 'Failed to add staff' });
            }
            res.json({ message: 'Staff account created successfully', staff_id: result.insertId });
        });
    });
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

app.post('/api/daily-track', verifyToken, (req, res) => {
    const studentId = req.user.id;
    const { mood_id, exercise_duration, sleep_duration, socialisation_id, productivity_score } = req.body;

    if (!mood_id || !exercise_duration || !sleep_duration || !socialisation_id || !productivity_score) {
        return res.status(400).json({ message: 'Missing required fields' });
    }

    const today = new Date().toISOString().split('T')[0];

    const checkRecordQuery = `
        SELECT * FROM daily_record 
        WHERE student_id = ? AND DATE(daily_record_timestamp) = ?
    `;

    db.query(checkRecordQuery, [studentId, today], (err, records) => {
        if (err) {
            console.error('Error checking daily record:', err);
            return res.status(500).send('Failed to check daily record');
        }

        if (records.length > 0) {
            return res.status(409).json({ message: 'Already tracked today' });
        }

        const insertQuery = `
            INSERT INTO daily_record (student_id, mood_id, exercise_duration, sleep_duration, socialisation_id, productivity_score) 
            VALUES (?, ?, ?, ?, ?, ?)
        `;

        db.query(insertQuery, [studentId, mood_id, exercise_duration, sleep_duration, socialisation_id, productivity_score], (err) => {
            if (err) {
                console.error('Error inserting daily record:', err);
                return res.status(500).json({ message: 'Failed to add daily record' });
            }

            const getStreakQuery = `
                SELECT * FROM streak 
                WHERE student_id = ?
            `;

            db.query(getStreakQuery, [studentId], (err, streaks) => {
                if (err) {
                    console.error('Error fetching streak:', err);
                    return res.status(500).json({ message: 'Failed to fetch streak' });
                }

                const currentDate = new Date();
                let streakValue = 1;
                let lastRecordDate = currentDate;

                if (streaks.length > 0) {
                    const streak = streaks[0];
                    const lastRecord = new Date(streak.last_record);
                    const oneDay = 24 * 60 * 60 * 1000;

                    if (currentDate - lastRecord <= oneDay) {
                        streakValue = streak.streak_value + 1;
                    } else {
                        streakValue = 1; // Reset streak if more than a day has passed
                    }

                    lastRecordDate = currentDate;

                    const updateStreakQuery = `
                        UPDATE streak 
                        SET streak_value = ?, last_record = ? 
                        WHERE student_id = ?
                    `;

                    db.query(updateStreakQuery, [streakValue, lastRecordDate, studentId], (err) => {
                        if (err) {
                            console.error('Error updating streak:', err);
                            return res.status(500).json({ message: 'Failed to update streak' });
                        }

                        return res.json({ message: 'Daily record and streak updated successfully', streakValue });
                    });
                } else {
                    const insertStreakQuery = `
                        INSERT INTO streak (streak_value, student_id, last_record) 
                        VALUES (?, ?, ?)
                    `;

                    db.query(insertStreakQuery, [streakValue, studentId, lastRecordDate], (err) => {
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

app.get('/api/student-details/:student_id', verifyToken, (req, res) => {
    const studentId = req.params.student_id; // Use req.params to get the student_id from the URL
    console.log('Student Id is ' + studentId);
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
        console.log('Student Details:', results[0]);
        const studentDetails = results[0];
        res.json(studentDetails);
    });
});



app.get('/api/staff-details/:staff_id', verifyToken, (req, res) => {
    const staffId = req.params.staff_id;
    const query = 'SELECT * FROM staff WHERE staff_id = ?';
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

app.get('/api/streak/:student_id', verifyToken, (req, res) => {
    const studentId = req.params.student_id;

    const getStreakQuery = `
            SELECT * FROM streak 
            WHERE student_id = ?
        `;

    db.query(getStreakQuery, [studentId], (err, streaks) => {
        if (err) {
            console.error('Error fetching streak:', err);
            return res.status(500).json({ message: 'Failed to fetch streak' });
        }

        if (streaks.length > 0) {
            return res.json({ streakValue: streaks[0].streak_value });
        } else {
            return res.json({ streakValue: 0 });
        }
    });
});





app.get('/api/mood/status', verifyToken, (req, res) => {
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


// app.post('/api/quick-track', verifyToken, (req, res) => {
//     const studentId = req.user.student_id;
//     const { mood_id } = req.body;
//     console.log('The student ID passed to quicktrack is: ' + studentId);
//     const today = new Date().toISOString().split('T')[0];

//     // Check if the student has already recorded 5 quick tracks today
//     const checkQuery = `
//         SELECT COUNT(*) as count FROM quick_track
//         WHERE student_id = ? AND DATE(quick_track_timestamp) = ?
//     `;

//     db.query(checkQuery, [studentId, today], (err, results) => {
//         if (err) {
//             console.error('Error checking quick track count:', err);
//             return res.status(500).json({ error: 'Failed to check quick track count' });
//         }

//         if (results[0].count >= 5) {
//             return res.status(409).json({ message: 'Already tracked 5 times today' });
//         }

//         // Insert the new quick track record
//         const insertQuery = `
//             INSERT INTO quick_track (student_id, mood_id)
//             VALUES (?, ?)
//         `;

//         db.query(insertQuery, [studentId, mood_id], (err, result) => {
//             if (err) {
//                 console.error('Error inserting quick track:', err);
//                 return res.status(500).json({ error: 'Failed to add quick track' });
//             }
//             res.json({ message: 'Quick track added successfully' });
//         });
//     });
// })
const cooldownPeriodSeconds = 1 * 60 * 60;

app.post('/api/quick-track', verifyToken, (req, res) => {
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
            const lastSubmissionTime = results[0].quick_track_timestamp;
            const now = new Date();
            const cooldownEndTime = new Date(lastSubmissionTime.getTime() + cooldownPeriodSeconds * 1000);

            if (now < cooldownEndTime) {
                // Calculate remaining time in seconds
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

// Check if student exists based on student number or email
app.get('/api/check-student', async (req, res) => {
    const { identifier } = req.query;
    const query = `
    SELECT * FROM student
    WHERE student_number = ? OR student_email = ?
  `;
    db.query(query, [identifier, identifier], (err, results) => {
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

app.get('/api/records/:student_id', verifyToken, (req, res) => {
    const studentId = req.params.student_id;

    const getRecordsQuery = `
           SELECT * FROM daily_record dr 
  JOIN moods m ON m.mood_id = dr.mood_id
  JOIN socialisation s ON s.socialisation_id = dr.socialisation_id
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

app.get('/api/quick-tracker/:student_id', verifyToken, (req, res) => {
    const studentId = req.params.student_id;

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

app.get('/api/assignments/:student_id', verifyToken, (req, res) => {
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

app.delete('/api/assignments/:assignment_id', verifyToken, (req, res) => {
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

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Internal server error:', err);
    res.status(500).json({ error: 'An internal server error occurred' });
});


app.listen(8000, () => {
    console.log('server is running on port 8000')
    db.connect(function (err) {
        if (err) throw err;
        console.log('connected to db');
    })
});