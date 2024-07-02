const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require("mysql2");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'mood_tracker',
    port: '8889'
});

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('JWT_SECRET is not defined in the environment variables');
    process.exit(1); // Exit the process if JWT_SECRET is not defined
}

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Forbidden: Invalid token' });
    }
    req.decoded = decoded;
    next();
  });
};

// Example middleware to verify admin role
const checkAdminRole = (req, res, next) => {
    // Example: Check if the user is an admin based on JWT token
    const token = req.headers.authorization.split(' ')[1];
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err || decoded.role !== 'admin') {
            return res.status(403).json({ error: 'Forbidden: Insufficient privileges' });
        }
        req.user = decoded;
        next();
    });
};


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
                db.query(insertQuery, [student_number, student_name, date_of_birth, student_email, course_id, year_id, student_password], (err, result) => {
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

app.post('/api/login', (req, res) => {
    //const { studentNumber, student_password } = req.body;
    const { number, password } = req.body;
    // Query to find the user by student number
    const studentQuery = `SELECT * FROM student WHERE student_number = ?`;
    const staffQuery = `SELECT * FROM staff WHERE staff_number = ?`;
    db.query(studentQuery, [number], async (err, studentResults) => {
        if (err) {
            console.error('Error fetching student:', err);
            return res.status(500).send('Error occurred');
        }

        if (studentResults.length > 0) {
            // Found user in student table
            const student = studentResults[0];
            try {
                const passwordMatch = await bcrypt.compare(password, student.student_password);
                if (passwordMatch) {
                    const token = jwt.sign({ id: student.student_id, role: student.role }, JWT_SECRET, { expiresIn: '1h' });
                    return res.json({ token });
                } else {
                    return res.status(401).send('Invalid credentials');
                }
            } catch (error) {
                console.error('Password comparison error:', error);
                return res.status(500).send('Error comparing passwords');
            }
        } else {
            // If not found in student table, try the admin table
            db.query(adminQuery, [number], async (err, adminResults) => {
                if (err) {
                    console.error('Error fetching admin:', err);
                    return res.status(500).send('Error occurred');
                }

                if (adminResults.length === 0) {
                    return res.status(401).send('Invalid credentials');
                }

                const admin = adminResults[0];
                try {
                    const passwordMatch = await bcrypt.compare(password, admin.admin_password);
                    if (passwordMatch) {
                        const token = jwt.sign({ id: admin.admin_id, role: admin.role }, JWT_SECRET, { expiresIn: '1h' });
                        return res.json({ token });
                    } else {
                        return res.status(401).send('Invalid credentials');
                    }
                } catch (error) {
                    console.error('Password comparison error:', error);
                    return res.status(500).send('Error comparing passwords');
                }
            });
        }
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

app.post('/api/mood', (req, res) => {
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
    const query = 'SELECT student_number, student_email FROM student WHERE student_id = ?';
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
  
  app.get('/api/streak', verifyToken, (req, res) => {
    const studentNumber = req.decoded.studentNumber;

    // Calculate streak using SQL query
    const streakQuery = `
        SELECT DATEDIFF(NOW(), MAX(daily_record_timestamp)) AS streak
        FROM daily_record
        WHERE student_id = (
            SELECT student_id FROM student WHERE student_number = ?
        )
        AND DATE(daily_record_timestamp) >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    `;
    db.query(streakQuery, [studentNumber], (err, results) => {
        if (err) {
            console.error('Error fetching streak:', err);
            res.status(500).json({ error: 'Failed to fetch streak' });
            return;
        }
        const streak = results[0] ? results[0].streak : 0;
        res.json({ streak });
    });
});


app.listen(3001, () => {
    console.log('server is running on port 3001')
    db.connect(function (err) {
        if (err) throw err;
        console.log('connected to db');
    })
});