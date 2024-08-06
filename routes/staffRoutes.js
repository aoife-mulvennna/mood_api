const verifyTokenStaff = passport.authenticate('staff-jwt', { session: false });

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

