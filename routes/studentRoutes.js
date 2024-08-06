const verifyTokenStudent = passport.authenticate('student-jwt', { session: false });
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

app.use('/api/quick-track', verifyTokenStudent);

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
            return data.length ? sum / data.length : 0;
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
