// videoProcessor.js

const { exec } = require('child_process');

const videoEnhancer = (inputFile, outputFile, mode) => {
    let ffmpegCommand;

    // Define command based on mode
    switch (mode) {
        case 1:
            ffmpegCommand = `ffmpeg -i ${inputFile} -vf "scale=1280:720" ${outputFile}`;  // Scale video
            break;
        case 2:
            ffmpegCommand = `ffmpeg -i ${inputFile} -b:v 1000k ${outputFile}`;  // Set bitrate
            break;
        case 3:
            ffmpegCommand = `ffmpeg -i ${inputFile} -vf "hue=h=180" ${outputFile}`; // Change hue
            break;
        default:
            throw new Error('Invalid mode selected. Choose 1, 2, or 3.');
    }

    // Execute command
    exec(ffmpegCommand, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.error(`FFmpeg stderr: ${stderr}`);
            return;
        }
        console.log(`Video processed successfully: ${outputFile}`);
    });
};

module.exports = videoEnhancer;
