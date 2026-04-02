import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import fs from "fs/promises";
import path from "path";
import { v4 as uuid } from "uuid";

ffmpeg.setFfmpegPath(ffmpegPath);

export async function processVideo(url) {
  const input = `temp_${uuid()}.mp4`;
  const output = `out_${uuid()}.mp4`;

  const res = await fetch(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(input, buffer);

  await new Promise((res, rej) => {
    ffmpeg(input)
      .videoFilters([
        "nlmeans=s=1.0",
        "scale=1920:-1:flags=lanczos",
        "unsharp=5:5:1.0"
      ])
      .outputOptions(["-crf 16", "-preset slow"])
      .save(output)
      .on("end", res)
      .on("error", rej);
  });

  return output;
}
