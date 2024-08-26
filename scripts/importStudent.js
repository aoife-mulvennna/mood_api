const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const bcrypt = require('bcrypt');
const db = require('../db'); // Adjust the path to your db.js file

const saltRounds = 10; // Salt rounds for bcrypt

const importStudents = async (csvFilePath) => {
    const records = [];
    
    // Step 1: Parse the CSV file
    await new Promise((resolve, reject) => {
        fs.createReadStream(csvFilePath)
            .pipe(csv())
            .on('data', (data) => {
                records.push(data);
            })
            .on('end', resolve)
            .on('error', reject);
    });

    // Step 2: Process each record
    for (const record of records) {
        const { student_number, student_name, date_of_birth, student_email, course_name, academic_year, student_password } = record;

        // Ensure student_email is defined and valid
        if (!student_email || !student_email.endsWith('@qub.ac.uk')) {
            console.error(`Invalid or missing email for student: ${student_number}, skipping this record.`);
            continue; // Skip this record if email is missing or invalid
        }

        // Rest of the code remains the same...
        // Step 3: Check for duplicates
        const checkDuplicateQuery = `SELECT * FROM student WHERE student_number = ?`;
        const [duplicateResults] = await db.query(checkDuplicateQuery, [student_number]);

        if (duplicateResults.length > 0) {
            console.error(`Duplicate student number found: ${student_number}`);
            continue; // Skip this record
        }

        // Step 4: Hash the password
        const hashedPassword = await bcrypt.hash(student_password, saltRounds);

        // Step 5: Get course_id based on course_name
        const getCourseIdQuery = `SELECT course_id FROM course WHERE course_name = ?`;
        const [courseResult] = await db.query(getCourseIdQuery, [course_name]);

        if (courseResult.length === 0) {
            console.error(`Course not found: ${course_name}`);
            continue; // Skip this record
        }

        const course_id = courseResult[0].course_id;

        // Step 6: Get academic_year_id based on academic_year
        const getYearIdQuery = `SELECT academic_year_id FROM academic_year WHERE academic_year_name = ?`;
        const [yearResult] = await db.query(getYearIdQuery, [academic_year]);

        if (yearResult.length === 0) {
            console.error(`Academic year not found: ${academic_year}`);
            continue; // Skip this record
        }

        const year_id = yearResult[0].academic_year_id;

        // Step 7: Insert the student into the student table
        const insertStudentQuery = `
            INSERT INTO student (student_number, student_name, date_of_birth, student_email, course_id, course_year_id, student_password) 
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `;
        const [insertResult] = await db.query(insertStudentQuery, [student_number, student_name, date_of_birth, student_email, course_id, year_id, hashedPassword]);

        const student_id = insertResult.insertId;

        // Step 8: Insert the initial streak into the streak table
        const initialStreakQuery = `INSERT INTO streak (streak_value, student_id) VALUES (0, ?)`;
        await db.query(initialStreakQuery, [student_id]);

        console.log(`Student ${student_name} added successfully with ID: ${student_id}`);
    }
    console.log('All students processed successfully');
};

// Run the import function
(async () => {
    try {
        const csvFilePath = path.join(__dirname, '../dataimports/student.csv'); // Update with your file path
        await importStudents(csvFilePath);
    } catch (error) {
        console.error('Error during import:', error);
    } finally {
        await db.end(); // Only close the connection pool after all records have been processed
    }
})();
