const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const db = require('../db'); // Make sure this uses the mysql2/promise module

// Function to import data into quick_track table
const importQuickTrack = async (csvFilePath) => {
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
        const { student_id, mood_id, quick_track_timestamp } = record; // Adjust according to your table structure
        try {
            await db.query(
                `INSERT INTO quick_track (student_id, mood_id, quick_track_timestamp)
                VALUES (?, ?, ?)`,
                [student_id, mood_id, quick_track_timestamp]
            );
        } catch (error) {
            console.error('Error inserting into quick_track:', error);
        }
    }
    console.log('Quick track records imported successfully');
};

// Run the import function
(async () => {
    try {
        const quickTrackPath = path.join(__dirname, '../dataimports/quick_track.csv'); // Update with your file path
        
        await importQuickTrack(quickTrackPath);
    } catch (error) {
        console.error('Error during import:', error);
    } finally {
        await db.end(); // Only close the connection pool after all records have been processed
    }
})();
