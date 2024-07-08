const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const { ExtractJwt } = require('passport-jwt');
const bcrypt = require('bcrypt');
const db = require('./db'); // Assuming you have your MySQL connection in a separate file
//const jwt = require('jsonwebtoken');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    console.error('JWT_SECRET is not defined in the environment variables');
    process.exit(1); // Exit the process if JWT_SECRET is not defined
}

// Local strategy for student username/password login
passport.use('student-local', new LocalStrategy({
    usernameField: 'studentNumber', // field names in your login form
    passwordField: 'studentPassword'
}, (studentNumber, studentPassword, done) => {
    db.query('SELECT * FROM student WHERE student_number = ?', [studentNumber], (err, results) => {
        if (err) {
            return done(err);
        }
        if (results.length === 0) {
            return done(null, false, { message: 'Incorrect student number' });
        }
        const student = results[0];
        bcrypt.compare(studentPassword, student.student_password, (err, isMatch) => {
            if (err) {
                return done(err);
            }
            if (!isMatch) {
                return done(null, false, { message: 'Incorrect password' });
            }
            return done(null, student);
        });
    });
}));

// Local strategy for staff username/password login
passport.use('staff-local', new LocalStrategy({
    usernameField: 'staffNumber', // field names in your login form
    passwordField: 'staffPassword'
}, (staffNumber, staffPassword, done) => {
    db.query('SELECT * FROM staff WHERE staff_number = ?', [staffNumber], async (err, results) => {
        if (err) {
            return done(err);
        }
        if (results.length === 0) {
            return done(null, false, { message: 'Invalid credentials' });
        }

        const staff = results[0];

        try {
            const passwordMatch = await bcrypt.compare(staffPassword, staff.staff_password);
            if (passwordMatch) {
                return done(null, staff);
            } else {
                return done(null, false, { message: 'Invalid credentials' });
            }
        } catch (error) {
            return done(error);
        }
    });
}));
// JWT strategy for protected routes
passport.use('student-jwt', new JwtStrategy(
    {
        jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
        secretOrKey: JWT_SECRET
    },
    (jwtPayload, done) => {
        db.query('SELECT * FROM student WHERE student_id = ?', [jwtPayload.id], (err, results) => {
            if (err) {
                return done(err, false);
            }
            if (results.length === 0) {
                return done(null, false);
            }
            return done(null, results[0]);
        });
    }
));

// JWT strategy for staff handling JWT token
const jwtStaffOptions = {
    jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
    secretOrKey: JWT_SECRET
};

passport.use('staff-jwt', new JwtStrategy(jwtStaffOptions, (payload, done) => {
    db.query('SELECT * FROM staff WHERE staff_id = ?', [payload.id], (err, results) => {
        if (err) {
            return done(err, false);
        }
        if (results.length === 0) {
            return done(null, false);
        }

        const staff = results[0];
        return done(null, staff);
    });
}));

// Serialize and Deserialize for both student and staff
passport.serializeUser((user, done) => {
    done(null, user.id); // Assuming both student and staff have id field
});

passport.deserializeUser((id, done) => {
    // Check both student and staff tables based on the user type
    db.query('SELECT * FROM student WHERE student_id = ?', [id], (err, studentResults) => {
        if (err) {
            return done(err);
        }
        if (studentResults.length > 0) {
            return done(null, studentResults[0]);
        } else {
            db.query('SELECT * FROM staff WHERE staff_id = ?', [id], (err, staffResults) => {
                if (err) {
                    return done(err);
                }
                if (staffResults.length > 0) {
                    return done(null, staffResults[0]);
                } else {
                    return done(null, false);
                }
            });
        }
    });
});
