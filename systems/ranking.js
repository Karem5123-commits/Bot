import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs/promises";
import path from "path";
import fetch from "node-fetch";
import { v4 as uuid } from "uuid";

ffmpeg.setFfmpegPath(ffmpegPath);

export async function processVideo(url) {
    const input = `temp_${uuid()}.mp4`;
    const output = `out_${uuid()}.mp4`;

    try {
        // Download video
        const res = await fetch(url);
        const buffer = Buffer.from(await res.arrayBuffer());
        await fs.writeFile(input, buffer);

        // Process (MAX QUALITY MODE)
        await new Promise((resolve, reject) => {
            ffmpeg(input)
                .videoFilters([
                    "scale=2560:-1:flags=lanczos",
                    "eq=contrast=1.15:brightness=0.05:saturation=1.2",
                    "unsharp=7:7:1.5",
                    "fps=60"
                ])
                .outputOptions([
                    "-c:v libx264",
                    "-preset veryfast",
                    "-crf 18",
                    "-movflags +faststart"
                ])
                .on("end", resolve)
                .on("error", reject)
                .save(output);
        });

        return output;

    } catch (err) {
        console.error("Video Processing Error:", err);
        throw err;
    } finally {
        // CLEANUP (critical for Railway)
        await fs.unlink(input).catch(() => {});
    }
}
