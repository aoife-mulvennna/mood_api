// db.js
const mysql = require('mysql2');

const db = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'root',
    database: 'mood_tracker',
    port: '8889'
});

db.connect(function(err) {
    if (err) {
        console.error('Error connecting to the database:', err);
        process.exit(1); // Exit the process with failure code
    }
    console.log('Connected to the database');
    
});

module.exports = db;
