const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require("mysql2");
const bcrypt = require('bcrypt');

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
    const { studentNumber, student_password } = req.body;

    // Query to find the user by student number
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

        const user = results[0];
        try {
            // Compare the provided password with the stored hashed password
            const passwordMatch = await bcrypt.compare(student_password, user.student_password);

            if (passwordMatch) {
                // Password matches, generate token
                const token = 'test123'; // Replace this with actual token generation logic
                res.json({ token });
            } else {
                // Password does not match
                res.status(401).send('Invalid credentials');
            }
        } catch (error) {
            console.error('Password comparison error:', error);
            res.status(500).send('Error comparing passwords');
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
    const { student_id, mood_name, exercise_duration, sleep_duration, socialisation } = req.body;

    const moodQuery = 'SELECT mood_id FROM moods WHERE mood_name = ?';
    db.query(moodQuery, [mood_name], (err, moodResult) => {
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


app.listen(3001, () => {
    console.log('server is running on port 3001')
    db.connect(function (err) {
        if (err) throw err;
        console.log('connected to db');
    })
});