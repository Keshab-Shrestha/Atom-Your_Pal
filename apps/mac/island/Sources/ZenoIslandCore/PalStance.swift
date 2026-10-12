import Foundation

/// ADR-104: where each part of a pal sits in one pose, on a 32-unit grid (the unit is a point on screen, scaled to
/// any size): the body, its head nodes (ears, horns, antenna), the arms and the feet, from the pal's own avatar
/// definition. The app draws these as smooth vector shapes. Pure: numbers only.
public enum PalStance {
    /// The drawing's width and height in units.
    public static let size = 32
    /// Where the body's centre sits.
    public static let centre = (x: 16.0, y: 18.0)
    /// The body's width in units; everything else scales with it.
    public static let bodyWidth = 16.0

    public enum Pose: String, CaseIterable, Sendable {
        case idle, bob, blink, typeA, typeB, walkA, walkB, cheer, sad
    }

    /// How far the body moves down (positive) or up in a pose.
    public static func lift(_ pose: Pose) -> Double {
        switch pose {
        case .bob, .walkB, .sad: 1
        case .cheer: -2
        default: 0
        }
    }

    /// Units per definition unit.
    public static func scale(_ pal: PalDefinition) -> Double { bodyWidth / max(pal.body.primary.width, 1) }

    public static func bodyHeight(_ pal: PalDefinition) -> Double { pal.body.primary.height * scale(pal) }

    /// The body's centre in a pose.
    public static func bodyCentre(_ pose: Pose) -> (x: Double, y: Double) { (centre.x, centre.y + lift(pose)) }

    /// A foot: its centre; the raised one when walking.
    public static func feet(_ pal: PalDefinition, pose: Pose) -> [(x: Double, y: Double)] {
        let c = bodyCentre(pose)
        let footY = centre.y + bodyHeight(pal) / 2 + 0.5 + (pose == .cheer ? lift(pose) : 0)
        return [(-1.0, pose == .walkA), (1.0, pose == .walkB)].map { side, raised in
            (c.x + side * bodyWidth * 0.24, footY - (raised ? 1 : 0))
        }
    }

    /// An arm from the shoulder to the hand.
    public static func arms(_ pose: Pose) -> [(shoulder: (x: Double, y: Double), hand: (x: Double, y: Double))] {
        let c = bodyCentre(pose)
        return [-1.0, 1.0].map { side in
            let angle = armAngle(pose, side: side) * .pi / 180
            let shoulder = (x: c.x + side * (bodyWidth / 2 - 0.5), y: c.y - 1 + (pose == .typeA || pose == .typeB ? 2 : 0))
            return (shoulder, (shoulder.x + side * sin(angle) * 5, shoulder.y + cos(angle) * 5))
        }
    }

    /// Degrees out from hanging straight down.
    public static func armAngle(_ pose: Pose, side: Double) -> Double {
        switch pose {
        case .cheer: 150
        case .typeA: side < 0 ? 4 : 14
        case .typeB: side < 0 ? 14 : 4
        case .walkA: side < 0 ? 20 : 45
        case .walkB: side < 0 ? 45 : 20
        case .sad: 8
        default: 32
        }
    }

    /// A head node placed in the drawing: centre, size, kind and its turn in degrees (counter-clockwise on screen).
    public struct Node: Sendable, Equatable {
        public var type: String
        public var x: Double, y: Double, width: Double, height: Double
        public var rotation: Double
    }

    /// The ears, horns and antenna on the head, as the file puts them.
    public static func headNodes(_ pal: PalDefinition, pose: Pose) -> [Node] {
        let k = scale(pal), c = bodyCentre(pose)
        return pal.body.nodes.filter { $0.position.count >= 2 && $0.position[1] > pal.body.primary.height * 0.4 }.map { node in
            Node(type: node.surface.type, x: c.x + node.position[0] * k, y: c.y - node.position[1] * k,
                 width: node.surface.width * k, height: node.surface.height * k, rotation: node.rotation.count >= 3 ? node.rotation[2] : 0)
        }
    }

    /// The highest point of the body and its head nodes (smaller is higher).
    public static func top(_ pal: PalDefinition, pose: Pose) -> Double {
        let body = bodyCentre(pose).y - bodyHeight(pal) / 2
        return headNodes(pal, pose: pose).reduce(body) { best, n in
            let phi = n.rotation * .pi / 180
            return min(best, n.y - (abs(cos(phi)) * n.height + abs(sin(phi)) * n.width) / 2)
        }
    }
}
