import path from "path"
import fs from "fs"
import { execFile } from "child_process"
import ffmpeg from "ffmpeg-static"

import { recFallbackDir } from "./config"

function runFFmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg!, args, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export async function concatVideoChunks(
  videoChunks: string[],
  outputPath: string
): Promise<string> {

  const listFile = path.join(recFallbackDir, `video_concat_${Date.now()}.txt`)

  fs.writeFileSync(
    listFile,
    videoChunks.map(f => `file '${f}'`).join("\n")
  )

  await runFFmpeg([
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-c", "copy",
    outputPath
  ])

  fs.unlinkSync(listFile)

  return outputPath
}

export async function concatAudioChunks(
  audioChunks: string[],
  outputPath: string
): Promise<string> {

  const listFile = path.join(recFallbackDir, `audio_concat_${Date.now()}.txt`)

  fs.writeFileSync(
    listFile,
    audioChunks.map(f => `file '${f}'`).join("\n")
  )

  await runFFmpeg([
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", listFile,
    "-c:a", "libopus",
    "-b:a", "128k",
    outputPath
  ])

  fs.unlinkSync(listFile)

  return outputPath
}

function ffmpegMerge(
  videoPath: string,
  audioPath: string,
  vidAudOffsetMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const tempOutput = videoPath + ".tmp.webm"

    const args = [
      "-y",
      "-ss", (vidAudOffsetMs / 1000).toFixed(3),
      "-i", videoPath,
      "-i", audioPath,
      "-c:v", "copy",
      "-c:a", "libopus",
      "-b:a", "128k",
      tempOutput
    ]

    execFile(ffmpeg!, args, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }

      try {
        // Delete the audio file
        fs.unlinkSync(audioPath)

        // Replace original video with merged one
        fs.renameSync(tempOutput, videoPath)
      } catch (err) {
        console.error("Cleanup/overwrite failed:", err)
        reject(err)
        return
      }

      resolve(videoPath)
    })
  })
}

// merges audio and video seperately
// files are to be in the format {timestamp}_{chunkNum}
export async function mergeAudioVideo(dirPath: string, ts: number, vidAudOffsetMs: number) {
    const allFiles = fs.readdirSync(dirPath)

    const filesToMerge: Record<number, { video?: string; audio?: string }> = {}

    for (const file of allFiles) {
        if (!file.startsWith(ts.toString())) continue

        const fullPath = path.join(dirPath, file)

        // filename format: ts_chunk.ext
        const [tsPart, chunkPart] = file.split("_")
        const chunk = parseInt(chunkPart!.split(".")[0]!, 10)

        if (!filesToMerge[chunk]) {
            filesToMerge[chunk] = {}
        }

        if (file.endsWith(".webm")) {
            filesToMerge[chunk].video = fullPath
        } else if (file.endsWith(".m4a")) {
            filesToMerge[chunk].audio = fullPath
        }
    }

    const merges: Promise<string>[] = []

    let c: number = 0
    for (const chunk of Object.keys(filesToMerge)) {
        const entry = filesToMerge[Number(chunk)]

        if (entry && entry.video && entry.audio) {
            merges.push(ffmpegMerge(entry.video, entry.audio, c ? 0 : vidAudOffsetMs))
            c++
        }
    }

    return Promise.all(merges)
}

export async function concatVideoAudioChunks(dirPath: string, ts: number) {
  const allFiles = fs.readdirSync(dirPath)

  const videoChunks: { chunk: number; path: string }[] = []
  const audioChunks: { chunk: number; path: string }[] = []

  for (const file of allFiles) {
    if (!file.startsWith(ts.toString())) continue

    const fullPath = path.join(dirPath, file)

    // filename format: ts_chunk.ext
    const [, chunkPart] = file.split("_")
    const chunk = parseInt(chunkPart!.split(".")[0]!, 10)

    if (file.endsWith(".webm")) {
      videoChunks.push({ chunk, path: fullPath })
    } else if (file.endsWith(".m4a")) {
      audioChunks.push({ chunk, path: fullPath })
    }
  }

  // Determine which chunks exist in BOTH streams
  const videoChunkSet = new Set(videoChunks.map(v => v.chunk))
  const audioChunkSet = new Set(audioChunks.map(a => a.chunk))

  const validChunks = [...videoChunkSet].filter(c => audioChunkSet.has(c))

  // Filter only valid chunks
  const filteredVideo = videoChunks
    .filter(v => validChunks.includes(v.chunk))
    .sort((a, b) => a.chunk - b.chunk)

  const filteredAudio = audioChunks
    .filter(a => validChunks.includes(a.chunk))
    .sort((a, b) => a.chunk - b.chunk)

  const videoPaths = filteredVideo.map(v => v.path)
  const audioPaths = filteredAudio.map(a => a.path)

  const finalVideoPath = path.join(dirPath, `${ts}_video.webm`)
  const finalAudioPath = path.join(dirPath, `${ts}_audio.opus`)

  const [videoResult, audioResult] = await Promise.all([
    concatVideoChunks(videoPaths, finalVideoPath),
    concatAudioChunks(audioPaths, finalAudioPath)
  ])

  return {
    videoPath: videoResult,
    audioPath: audioResult
  }
}
