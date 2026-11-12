//! The brain graph layout: a small force-directed layout with a fixed start, so the same notes always draw the same way.

/// One placed node, in the box `0..width` by `0..height`.
#[derive(Debug, Clone, PartialEq)]
pub struct Placed {
    pub id: u64,
    pub x: f32,
    pub y: f32,
}

const ROUNDS: usize = 120;
const MARGIN: f32 = 14.0;

/// Places `ids` in a `width` by `height` box. Linked nodes pull together, all nodes push apart, and a weak pull
/// to the middle keeps the groups on screen. Edges that name an unknown id are ignored.
pub fn layout(ids: &[u64], edges: &[(u64, u64)], width: f32, height: f32) -> Vec<Placed> {
    let n = ids.len();
    if n == 0 {
        return Vec::new();
    }
    let (cx, cy) = (width / 2.0, height / 2.0);
    let radius = (width.min(height) / 2.0 - MARGIN).max(1.0);
    // Start on a circle, in the order given.
    let mut pos: Vec<[f32; 2]> = (0..n)
        .map(|i| {
            let a = std::f32::consts::TAU * i as f32 / n as f32;
            [cx + radius * 0.8 * a.cos(), cy + radius * 0.8 * a.sin()]
        })
        .collect();
    let index = |id: u64| ids.iter().position(|x| *x == id);
    let links: Vec<(usize, usize)> = edges.iter().filter_map(|(a, b)| Some((index(*a)?, index(*b)?))).filter(|(a, b)| a != b).collect();
    let ideal = (width * height / n as f32).sqrt() * 0.7;
    for round in 0..ROUNDS {
        let cool = 1.0 - round as f32 / ROUNDS as f32;
        let mut push = vec![[0.0f32; 2]; n];
        for i in 0..n {
            for j in (i + 1)..n {
                let (dx, dy) = (pos[i][0] - pos[j][0], pos[i][1] - pos[j][1]);
                let d2 = (dx * dx + dy * dy).max(0.01);
                let f = ideal * ideal / d2;
                push[i][0] += dx * f;
                push[i][1] += dy * f;
                push[j][0] -= dx * f;
                push[j][1] -= dy * f;
            }
        }
        for (a, b) in &links {
            let (dx, dy) = (pos[*a][0] - pos[*b][0], pos[*a][1] - pos[*b][1]);
            let d = (dx * dx + dy * dy).sqrt().max(0.01);
            let f = d / ideal;
            push[*a][0] -= dx * f;
            push[*a][1] -= dy * f;
            push[*b][0] += dx * f;
            push[*b][1] += dy * f;
        }
        for i in 0..n {
            push[i][0] += (cx - pos[i][0]) * 0.05;
            push[i][1] += (cy - pos[i][1]) * 0.05;
            let len = (push[i][0] * push[i][0] + push[i][1] * push[i][1]).sqrt().max(0.01);
            let step = len.min(ideal * 0.2 * cool + 0.5);
            pos[i][0] = (pos[i][0] + push[i][0] / len * step).clamp(MARGIN, (width - MARGIN).max(MARGIN));
            pos[i][1] = (pos[i][1] + push[i][1] / len * step).clamp(MARGIN, (height - MARGIN).max(MARGIN));
        }
    }
    ids.iter().zip(pos).map(|(id, p)| Placed { id: *id, x: p[0], y: p[1] }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_layout_stays_in_the_box_and_is_the_same_every_time() {
        let ids: Vec<u64> = (1..=12).collect();
        let edges = [(1, 2), (2, 3), (3, 1), (4, 5), (99, 1)];
        let a = layout(&ids, &edges, 600.0, 320.0);
        assert_eq!(a, layout(&ids, &edges, 600.0, 320.0));
        assert!(a.iter().all(|p| (0.0..=600.0).contains(&p.x) && (0.0..=320.0).contains(&p.y)));
        assert!(layout(&[], &[], 10.0, 10.0).is_empty());
    }

    #[test]
    fn linked_notes_end_up_closer_than_the_average_pair() {
        let ids: Vec<u64> = (1..=10).collect();
        let a = layout(&ids, &[(1, 2)], 600.0, 400.0);
        let d = |i: usize, j: usize| ((a[i].x - a[j].x).powi(2) + (a[i].y - a[j].y).powi(2)).sqrt();
        let mut sum = 0.0;
        let mut count = 0.0;
        for i in 0..10 {
            for j in (i + 1)..10 {
                sum += d(i, j);
                count += 1.0;
            }
        }
        assert!(d(0, 1) < sum / count);
    }
}
