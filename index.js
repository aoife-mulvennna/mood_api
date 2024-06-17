const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const mysql = require("mysql2");

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
        console.log('getting rows');
        res.send(rows);
    })
})

app.post('/api/mood', (req, res) => {
    const query = `INSERT INTO moods (mood_name) values (?)`
    const values = [
        req.body.mood_name
    ]
    db.query(query, values, function (err, rows, fields) {
        if (err) {
            console.error('Error inserting mood:', err);
            res.status(500).json({ message: 'Failed to add mood' });
            return;
        }
        res.json('Added mood successfully');
    })
})
app.listen(3001, () => {
    console.log('server is running on port 3001')
    db.connect(function (err) {
        if (err) throw err;
        console.log('connected to db');
    })
});