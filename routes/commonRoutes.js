
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


const testEmailAddress = 'amulvenna10@qub.ac.uk';


// Scheduled job to check for 14-day inactivity (running daily at midnight)
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



app.post('/api/logout', (req, res) => {
    // Simply return a success response indicating logout
    res.json({ message: 'Logged out successfully' });
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
