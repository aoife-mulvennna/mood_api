const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const db = require('../db'); // Make sure this uses the mysql2/promise module

// Function to import data into daily_record table
const importDailyRecord = async (csvFilePath) => {
    const records = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(csvFilePath)
            .pipe(csv())
            .on('data', (data) => {
                // Ensure no null values for productivity_score
                const productivity_score = data.productivity_score ? data.productivity_score : 1; // Default to 1 if null
                records.push({ ...data, productivity_score });
            })
            .on('end', resolve)
            .on('error', reject);
    });

    for (const record of records) {
        const { daily_record_timestamp, student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score } = record;
        try {
            await db.query(
                `INSERT INTO daily_record (daily_record_timestamp, student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [daily_record_timestamp, student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score]
            );
        } catch (error) {
            console.error('Error inserting into daily_record:', error);
        }
    }
    console.log('Daily records imported successfully');
};

// Function to import data into daily_record_tag table
const importDailyRecordTag = async (csvFilePath) => {
    const records = [];
    await new Promise((resolve, reject) => {
        fs.createReadStream(csvFilePath)
            .pipe(csv())
            .on('data', (data) => {
                records.push(data);
            })
            .on('end', resolve)
            .on('error', reject);
    });

    for (const record of records) {
        const { daily_record_id, tag_id } = record;
        try {
            await db.query(
                `INSERT INTO daily_record_tag (daily_record_id, tag_id)
                VALUES (?, ?)`,
                [daily_record_id, tag_id]
            );
        } catch (error) {
            console.error('Error inserting into daily_record_tag:', error);
        }
    }
    console.log('Daily record tags imported successfully');
};

// Run the import functions
(async () => {
    try {
        const dailyRecordPath = path.join(__dirname, '../dataimports/daily_record.csv'); // Update with your file path
        const dailyRecordTagPath = path.join(__dirname, '../dataimports/daily_record_tag.csv'); // Update with your file path
        
        await importDailyRecord(dailyRecordPath);
        await importDailyRecordTag(dailyRecordTagPath);
    } catch (error) {
        console.error('Error during import:', error);
    } finally {
        await db.end(); // Only close the connection pool after all records have been processed
    }
})();
