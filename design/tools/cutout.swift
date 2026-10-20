// 用 macOS Vision 去背：swift cutout.swift <in.png> <out.png>
// 以前景實例遮罩輸出透明背景 PNG，並裁切到內容邊界（留 2% 邊距）。
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: cutout <in> <out>\n".data(using: .utf8)!)
  exit(2)
}
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])

guard let input = CIImage(contentsOf: inURL) else { fatalError("cannot read \(inURL.path)") }
let handler = VNImageRequestHandler(ciImage: input)
let request = VNGenerateForegroundInstanceMaskRequest()
try handler.perform([request])
guard let result = request.results?.first else { fatalError("no foreground found") }

let maskBuffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
let mask = CIImage(cvPixelBuffer: maskBuffer)
let clear = CIImage(color: .clear).cropped(to: input.extent)
let cut = input.applyingFilter("CIBlendWithMask", parameters: [
  kCIInputBackgroundImageKey: clear,
  kCIInputMaskImageKey: mask,
])

let ctx = CIContext()
guard let cg = ctx.createCGImage(cut, from: input.extent) else { fatalError("render failed") }

// 依 alpha 找內容邊界
let w = cg.width, h = cg.height
var pixels = [UInt8](repeating: 0, count: w * h * 4)
let cs = CGColorSpaceCreateDeviceRGB()
let bctx = CGContext(data: &pixels, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                     space: cs, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
bctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
var minX = w, minY = h, maxX = 0, maxY = 0
for y in 0..<h {
  for x in 0..<w where pixels[(y * w + x) * 4 + 3] > 16 {
    minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y)
  }
}
let pad = Int(Double(max(w, h)) * 0.02)
let crop = CGRect(x: max(0, minX - pad), y: max(0, minY - pad),
                  width: min(w, maxX + pad) - max(0, minX - pad), height: min(h, maxY + pad) - max(0, minY - pad))
let cropped = cg.cropping(to: crop)!
let rep = NSBitmapImageRep(cgImage: cropped)
try rep.representation(using: .png, properties: [:])!.write(to: outURL)
print("ok \(cropped.width)x\(cropped.height)")
