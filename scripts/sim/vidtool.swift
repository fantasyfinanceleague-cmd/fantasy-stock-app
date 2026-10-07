// vidtool: frame-rate report + frame extraction for simulator recordings (no ffmpeg on this Mac).
//   swift vidtool.swift info <video>
//   swift vidtool.swift frames <video> <outdir> <fps> [start] [end] [width]
import AVFoundation
import AppKit

let args = CommandLine.arguments
let url = URL(fileURLWithPath: args[2])
let asset = AVURLAsset(url: url)
let track = asset.tracks(withMediaType: .video).first!

if args[1] == "gaps" {
    let reader = try! AVAssetReader(asset: asset)
    let out = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    reader.add(out)
    reader.startReading()
    var times: [Double] = []
    while let s = out.copyNextSampleBuffer() { let t = CMSampleBufferGetPresentationTimeStamp(s).seconds; if t.isFinite { times.append(t) } }
    times.sort()  // H.264 B-frames arrive in DECODE order; presentation order is what the eye sees
    var line = ""
    for (a, b) in zip(times, times.dropFirst()) { line += String(format: "%.0f ", (b - a) * 1000) }
    print(line)
    exit(0)
}
if args[1] == "info" {
    // Count real samples: simctl recordings are variable-frame-rate (a frame is written only when the screen changes).
    let reader = try! AVAssetReader(asset: asset)
    let out = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
    reader.add(out)
    reader.startReading()
    var times: [Double] = []
    while let s = out.copyNextSampleBuffer() { let t = CMSampleBufferGetPresentationTimeStamp(s).seconds; if t.isFinite { times.append(t) } }
    times.sort()  // H.264 B-frames arrive in DECODE order; presentation order is what the eye sees
    let dur = asset.duration.seconds
    var gaps = zip(times.dropFirst(), times).map { $0 - $1 }.sorted()
    let median = gaps.isEmpty ? 0 : gaps[gaps.count / 2]
    let p95 = gaps.isEmpty ? 0 : gaps[Int(Double(gaps.count - 1) * 0.95)]
    let maxGap = gaps.last ?? 0
    // Drops: while the screen is continuously changing (gaps < 150 ms), a gap
    // over 25 ms means at least one 60 Hz frame was skipped.
    let motion = gaps.filter { $0 < 0.150 }
    let drops = motion.filter { $0 > 0.025 }.count
    print(String(format: "motion frames %d  late (>25 ms) %d = %.1f%%", motion.count, drops, motion.isEmpty ? 0 : Double(drops) * 100 / Double(motion.count)))
    gaps.removeAll()
    print(String(format: "duration %.2fs  frames %d  nominal %.1f fps  median gap %.1f ms (%.0f fps)  p95 gap %.1f ms  max gap %.1f ms",
                 dur, times.count, track.nominalFrameRate, median * 1000, median > 0 ? 1 / median : 0, p95 * 1000, maxGap * 1000))
    exit(0)
}

let outDir = args[3]
let fps = Double(args[4])!
let start = args.count > 5 ? Double(args[5])! : 0
let end = args.count > 6 ? Double(args[6])! : asset.duration.seconds
let width = args.count > 7 ? Double(args[7])! : 300
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: width, height: width * 3)
var t = start
var i = 0
while t <= end {
    if let cg = try? gen.copyCGImage(at: CMTime(seconds: t, preferredTimescale: 600), actualTime: nil) {
        let rep = NSBitmapImageRep(cgImage: cg)
        let data = rep.representation(using: .png, properties: [:])!
        try! data.write(to: URL(fileURLWithPath: String(format: "%@/f%03d.png", outDir, i)))
        i += 1
    }
    t += 1 / fps
}
print("wrote \(i) frames")
