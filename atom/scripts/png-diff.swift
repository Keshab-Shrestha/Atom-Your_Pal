// Compares two PNG files pixel by pixel. Prints "<changed pixels in percent> <width>x<height>"; "size" when the sizes differ.
// A pixel counts as changed when any colour channel differs by more than 24 of 255 (text edges move a little between renders).
// Run with: swift scripts/png-diff.swift golden.png new.png [diff.png]  (the optional diff.png marks changed pixels in red)
import CoreGraphics
import Foundation
import ImageIO

func load(_ path: String) -> (data: [UInt8], width: Int, height: Int)? {
  guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { return nil }
  let w = image.width, h = image.height
  var data = [UInt8](repeating: 0, count: w * h * 4)
  let ok = data.withUnsafeMutableBytes { buffer -> Bool in
    guard let context = CGContext(data: buffer.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
    context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return true
  }
  return ok ? (data, w, h) : nil
}

let args = CommandLine.arguments
guard args.count >= 3, let a = load(args[1]), let b = load(args[2]) else {
  FileHandle.standardError.write(Data("usage: png-diff golden.png new.png [diff.png]\n".utf8))
  exit(2)
}
guard a.width == b.width, a.height == b.height else {
  print("size \(a.width)x\(a.height) vs \(b.width)x\(b.height)")
  exit(1)
}

var changed = 0
var marked = b.data
for i in stride(from: 0, to: a.data.count, by: 4) {
  let delta = max(abs(Int(a.data[i]) - Int(b.data[i])), abs(Int(a.data[i + 1]) - Int(b.data[i + 1])), abs(Int(a.data[i + 2]) - Int(b.data[i + 2])))
  if delta > 24 {
    changed += 1
    marked[i] = 255; marked[i + 1] = 0; marked[i + 2] = 0; marked[i + 3] = 255
  }
}
let percent = Double(changed) * 100 / Double(a.width * a.height)
print(String(format: "%.3f %dx%d", percent, a.width, a.height))

if args.count >= 4 {
  marked.withUnsafeMutableBytes { buffer in
    guard let context = CGContext(data: buffer.baseAddress, width: a.width, height: a.height, bitsPerComponent: 8, bytesPerRow: a.width * 4,
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
      let image = context.makeImage(),
      let out = CGImageDestinationCreateWithURL(URL(fileURLWithPath: args[3]) as CFURL, "public.png" as CFString, 1, nil) else { return }
    CGImageDestinationAddImage(out, image, nil)
    CGImageDestinationFinalize(out)
  }
}
