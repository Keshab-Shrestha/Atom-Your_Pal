import CoreGraphics
import Foundation

// ADR-090: a small pixel buffer for the office floor's 2D art (the office and the pals), drawn pixel by pixel and
// shown scaled up without smoothing. Pure, apart from making a CGImage.

public struct PixelColor: Sendable, Equatable, Hashable {
    public var r: UInt8, g: UInt8, b: UInt8, a: UInt8

    public init(_ r: UInt8, _ g: UInt8, _ b: UInt8, _ a: UInt8 = 255) {
        self.r = r
        self.g = g
        self.b = b
        self.a = a
    }

    public init(hex: UInt32, alpha: UInt8 = 255) {
        self.init(UInt8((hex >> 16) & 0xFF), UInt8((hex >> 8) & 0xFF), UInt8(hex & 0xFF), alpha)
    }

    /// "#rrggbb", as in a pal's file; nil if it is not one.
    public init?(css: String) {
        let digits = css.hasPrefix("#") ? String(css.dropFirst()) : css
        guard digits.count == 6, let value = UInt32(digits, radix: 16) else { return nil }
        self.init(hex: value)
    }

    public static let clear = PixelColor(0, 0, 0, 0)

    /// Lighter above 1, darker below.
    public func shade(_ factor: Double) -> PixelColor {
        func c(_ v: UInt8) -> UInt8 { UInt8(max(0, min(255, (Double(v) * factor).rounded()))) }
        return PixelColor(c(r), c(g), c(b), a)
    }

    public func with(alpha: UInt8) -> PixelColor { PixelColor(r, g, b, alpha) }
}

public struct PixelCanvas: Sendable, Equatable {
    public let width: Int
    public let height: Int
    public private(set) var pixels: [PixelColor]

    public init(width: Int, height: Int) {
        self.width = width
        self.height = height
        pixels = Array(repeating: .clear, count: width * height)
    }

    public subscript(x: Int, y: Int) -> PixelColor {
        guard x >= 0, y >= 0, x < width, y < height else { return .clear }
        return pixels[y * width + x]
    }

    /// Paints one pixel; a translucent colour is blended over what is there. Outside the canvas: nothing.
    public mutating func set(_ x: Int, _ y: Int, _ c: PixelColor) {
        guard x >= 0, y >= 0, x < width, y < height, c.a > 0 else { return }
        let i = y * width + x
        if c.a == 255 { pixels[i] = c; return }
        let under = pixels[i], t = Double(c.a) / 255
        func mix(_ a: UInt8, _ b: UInt8) -> UInt8 { UInt8((Double(a) * (1 - t) + Double(b) * t).rounded()) }
        pixels[i] = PixelColor(mix(under.r, c.r), mix(under.g, c.g), mix(under.b, c.b), max(under.a, c.a))
    }

    public mutating func rect(_ x: Int, _ y: Int, _ w: Int, _ h: Int, _ c: PixelColor) {
        guard w > 0, h > 0 else { return }
        for yy in y..<(y + h) { for xx in x..<(x + w) { set(xx, yy, c) } }
    }

    /// A one-pixel outline.
    public mutating func frame(_ x: Int, _ y: Int, _ w: Int, _ h: Int, _ c: PixelColor) {
        rect(x, y, w, 1, c)
        rect(x, y + h - 1, w, 1, c)
        rect(x, y, 1, h, c)
        rect(x + w - 1, y, 1, h, c)
    }

    /// Draws another canvas on this one at (x, y); its clear pixels leave this one as it was.
    public mutating func stamp(_ other: PixelCanvas, _ x: Int, _ y: Int) {
        for yy in 0..<other.height { for xx in 0..<other.width { set(x + xx, y + yy, other[xx, yy]) } }
    }

    public func cgImage() -> CGImage? {
        var bytes = [UInt8]()
        bytes.reserveCapacity(width * height * 4)
        for p in pixels {
            // Premultiplied, as Core Graphics wants it.
            let a = Double(p.a) / 255
            bytes += [UInt8((Double(p.r) * a).rounded()), UInt8((Double(p.g) * a).rounded()), UInt8((Double(p.b) * a).rounded()), p.a]
        }
        guard let provider = CGDataProvider(data: Data(bytes) as CFData) else { return nil }
        return CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: width * 4,
                       space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
                       provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
    }
}
