const emailjs = require('emailjs-com');

const sendEmail = (email, subject, message, resetLink = '', loginLink = '') => {
    const templateParams = {
        subject,
        message,
        user_email: email,
        reset_link: resetLink || '',
        login_link: loginLink || '',
    };

    console.log(resetLink);
    console.log('Template Params:', templateParams);
    emailjs.send('service_28erwgn', 'template_2a4altz', templateParams, 'aZlnGJW3rE0XE38uz')
        .then((response) => {
            console.log('Email sent successfully:', response.status, response.text);
        })
        .catch((err) => {
            console.error('Failed to send email:', err);
        });
};

module.exports = sendEmail;
