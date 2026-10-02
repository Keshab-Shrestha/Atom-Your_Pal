/// A point on the ground under Wisp, in screen coordinates (origin bottom-left of the primary display, as
/// AppKit uses them). `x` is the centre of Wisp, `y` its feet.
public struct PetSpot: Sendable, Equatable {
    public var x: Double
    public var y: Double

    public init(x: Double, y: Double) {
        self.x = x
        self.y = y
    }
}
