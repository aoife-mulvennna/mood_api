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

app.post('/api/mood', verifyToken, (req, res) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    console.log('Token received:', token);

    if (!token) {
        return res.status(401).send('Unauthorized: No token provided'); // Unauthorized
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error('JWT verification error:', err);
            return res.status(403).send('Forbidden: Invalid token');// Forbidden
        }

        const studentNumber = decoded.studentNumber;
        console.log('Decoded token:', decoded);

        const { mood_name, exercise_duration, sleep_duration, socialisation } = req.body;

        const query = `SELECT * FROM student WHERE student_number = ?`;
        db.query(query, [studentNumber], async (err, results) => {
            if (err) {
                console.error('Error fetching user:', err);
                res.status(500).send('Error occurred');
                return;
            }

            if (results.length === 0) {
                // User not found
                res.status(401).send('Invalid credentials');
                return;
            }

            const student_id = results[0].student_id;

            // Check if the student has already submitted a record for today
            const today = new Date().toISOString().split('T')[0];
            const checkRecordQuery = `
                 SELECT * FROM daily_record 
                 WHERE student_id = ? AND DATE(daily_record_timestamp) = ?
             `;
            db.query(checkRecordQuery, [student_id, today], (err, records) => {
                if (err) {
                    console.error('Error checking daily record:', err);
                    res.status(500).send('Failed to check daily record');
                    return;
                }

                if (records.length > 0) {
                    // User has already tracked for today
                    return res.status(409).json({ message: 'Already tracked today' });
                }

                const getMoodIdQuery = 'SELECT mood_id FROM moods WHERE mood_name = ?';
                db.query(getMoodIdQuery, [mood_name], (err, moodResult) => {
                    if (err) {
                        console.error('Error fetching mood_id:', err);
                        res.status(500).json({ message: 'Failed to fetch mood_id' });
                        return;
                    }

                    if (moodResult.length === 0) {
                        res.status(404).json({ message: 'Mood not found' });
                        return;
                    }

                    const mood_id = moodResult[0].mood_id;

                    const insertQuery = `
            INSERT INTO daily_record (student_id, mood_id, exercise_duration, sleep_duration, socialisation) 
            VALUES (?, ?, ?, ?, ?)
        `;
                    db.query(insertQuery, [student_id, mood_id, exercise_duration, sleep_duration, socialisation], (err, rows) => {
                        if (err) {
                            console.error('Error inserting mood:', err);
                            res.status(500).json({ message: 'Failed to add mood' });
                            return;
                        }
                        res.json({ message: 'Added record successfully' });
                    });
                });
            });
        });
    });
});

app.post('/api/logout', (req, res) => {
    // Simply return a success response indicating logout
    res.json({ message: 'Logged out successfully' });
});

// Route to fetch student details for logged-in student
app.get('/api/student-details/:student_id', verifyToken, (req, res) => {
    const studentId = req.params.student_id;
    const query = 'SELECT * FROM student WHERE student_id = ?';
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


app.get('/api/streak', verifyToken, (req, res) => {
    const studentId = req.params.student_id;
    // Calculate streak using SQL query
    const streakQuery = `
SELECT
    student_id,
    MAX(current_streak) AS current_streak
FROM
    (
        SELECT
            student_id,
            daily_record_timestamp,
            CASE
                WHEN @prev_date := DATE_SUB(daily_record_timestamp, INTERVAL 1 DAY) THEN
                    IF(@prev_date = @expected_date, @streak := @streak + 1, @streak := 1)
                ELSE
                    @streak := 1
            END AS current_streak,
            @expected_date := daily_record_timestamp
        FROM
            (
                -- Get all records for the last 30 days for a specific student
                SELECT
                    dr.student_id,
                    dr.daily_record_timestamp
                FROM
                    daily_record dr
                JOIN
                    student s ON dr.student_id = s.student_id
                WHERE
                    s.student_id = ?
                    AND dr.daily_record_timestamp >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
                    AND dr.daily_record_timestamp <= CURDATE()
                ORDER BY
                    dr.daily_record_timestamp DESC
            ) AS ordered_records
        CROSS JOIN
            (SELECT @streak := 0, @prev_date := NULL, @expected_date := NULL) AS vars
        ORDER BY
            daily_record_timestamp DESC
    ) AS streaks
GROUP BY
    student_id
    `;
    db.query(streakQuery, [studentId], (err, results) => {
        if (err) {
            console.error('Error fetching streak:', err);
            res.status(500).json({ error: 'Failed to fetch streak' });
            return;
        }
        const streak = results[0] ? results[0].streak : 0;
        res.json({ streak });
    });
});

app.get('/api/mood/status', verifyToken, (req, res) => {
    const studentId = req.params.student_id; // Assuming you have student_id in your decoded JWT token
    const today = new Date().toISOString().split('T')[0];

    const query = 'SELECT * FROM daily_record WHERE student_id = ? AND DATE(daily_record_timestamp) = ?';
    db.query(query, [studentId, today], (err, results) => {
        if (err) {
            console.error('Error fetching mood:', err);
            return res.status(500).send('Error occurred');
        }
        if (results.length > 0) {
            return res.json({ alreadyTracked: true });
        } else {
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
app.post('/api/quick-track', verifyToken, (req, res) => {
    const studentId = req.user.student_id; // Ensure this line correctly retrieves student_id
    const { mood_id } = req.body;

    // Check if studentId is defined
    if (!studentId) {
        return res.status(400).json({ error: 'Student ID is missing or invalid' });
    }

    // Example insert query
    const insertQuery = `
        INSERT INTO quick_track (student_id, mood_id, timestamp)
        VALUES (?, ?, NOW())
    `;

    db.query(insertQuery, [studentId, mood_id], (err, result) => {
        if (err) {
            console.error('Error inserting quick track:', err);
            return res.status(500).json({ error: 'Failed to add quick track' });
        }
        res.json({ message: 'Quick track added successfully' });
    });
});



app.listen(8000, () => {
    console.log('server is running on port 8000')
    db.connect(function (err) {
        if (err) throw err;
        console.log('connected to db');
    })
});