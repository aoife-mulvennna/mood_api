const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const db = require('../db'); // Ensure this uses the mysql2/promise module

// Function to import data into daily_record table
const importDailyRecord = async (csvFilePath) => {
    const records = [];
    const idMap = {}; 
    await new Promise((resolve, reject) => {
        fs.createReadStream(csvFilePath)
            .pipe(csv())
            .on('data', (data) => {
                const productivity_score = data.productivity_score ? data.productivity_score : 1;
                records.push({ ...data, productivity_score });
            })
            .on('end', resolve)
            .on('error', reject);
    });
    for (const record of records) {
        const { daily_record_timestamp, student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score } = record;
        try {
            const [result] = await db.query(
                `INSERT INTO daily_record (daily_record_timestamp, student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [daily_record_timestamp, student_id, mood_id, exercise_id, sleep_id, socialisation_id, productivity_score]
            );
            const generatedId = result.insertId; 
            idMap[generatedId] = { mood_id, exercise_id, sleep_id, socialisation_id };

        } catch (error) {
            console.error('Error inserting into daily_record:', error);
        }
    }
    console.log('Daily records imported successfully');
    return idMap; 
};

// Function to generate and import data into daily_record_tag table
const generateAndImportDailyRecordTag = async (idMap) => {
    const dailyTrackTagData = [];
    const tagsMapping = {
        "low_mood": [1, 6, 2, 3], 
        "high_mood": [],      
        "poor_sleep": [1, 6, 2, 3],  
        "low_exercise": [6, 2, 3], 
        "social_isolation": [6, 7]  
    };
    for (const [daily_record_id, factors] of Object.entries(idMap)) {
        let associatedTags = [];
        if (factors.mood_id === 15 || factors.mood_id === 18) { // Sad or Discontent
            associatedTags = associatedTags.concat(tagsMapping['low_mood']);
        }
        if (factors.sleep_id === 0 || factors.sleep_id === 1) { // Very Poor or Poor Sleep
            associatedTags = associatedTags.concat(tagsMapping['poor_sleep']);
        }
        if (factors.exercise_id === 0 || factors.exercise_id === 1) { // Low Exercise
            associatedTags = associatedTags.concat(tagsMapping['low_exercise']);
        }
        if (factors.socialisation_id === 0 || factors.socialisation_id === 1) { // Low Socialisation
            associatedTags = associatedTags.concat(tagsMapping['social_isolation']);
        }
        associatedTags = [...new Set(associatedTags)];
        associatedTags.forEach(tag_id => {
            dailyTrackTagData.push({
                daily_record_id,
                tag_id
            });
        });
    }

    // Insert the generated tag data into the database
    for (const record of dailyTrackTagData) {
        try {
            await db.query(
                `INSERT INTO daily_record_tag (daily_record_id, tag_id)
                VALUES (?, ?)`,
                [record.daily_record_id, record.tag_id]
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
        const dailyRecordPath = path.join(__dirname, '../dataimports/daily_record.csv');

        // Import daily records and get the idMap
        const idMap = await importDailyRecord(dailyRecordPath);

        // Generate and insert daily record tags based on the idMap
        await generateAndImportDailyRecordTag(idMap);

    } catch (error) {
        console.error('Error during import:', error);
    } finally {
        await db.end(); // Only close the connection pool after all records have been processed
    }
})();
