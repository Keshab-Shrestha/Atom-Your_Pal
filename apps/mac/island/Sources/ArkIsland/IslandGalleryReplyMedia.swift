import Foundation
import SwiftUI
import ArkIslandCore

extension IslandGallery {
    /// 2026-11-02: a reply with a bar chart, a ring, a file image and a web image waiting for "Show image"; and a logo drawn as SVG.
    static func writeReplyMedia(to directory: URL) {
        save(AppIconArt.icon, name: "46-reply-media-sample", to: directory)
        let sample = directory.appendingPathComponent("46-reply-media-sample.png").path
        let reply = """
        Here is the week, by provider.

        ```chart
        {"type":"bar","title":"Tokens per day (thousands)","labels":["Mon","Tue","Wed","Thu","Fri"],"series":[{"name":"Claude","values":[42,38,51,47,33]},{"name":"Codex","values":[12,18,9,22,15]}]}
        ```

        ```chart
        {"type":"pie","title":"Where the time went","labels":["Chat","Agents","Voice"],"series":[{"name":"Hours","values":[6,3.5,1]}]}
        ```

        The app icon, from a file on this Mac:
        ![ARK app icon](\(sample))
        ![A Cedar venue photo](https://example.com/cedar/venue.jpg)
        """
        for (name, theme) in [("46-reply-media-dark", AppTheme.void), ("46-reply-media-light", AppTheme.daylight)] {
            let suite = "ark.gallery.reply-media.\(name).\(ProcessInfo.processInfo.processIdentifier)"
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            model.settings.theme = theme
            model.status.apply(.running(pid: 1))
            if let event = try? decodeEvent(#"{"type":"chats","current":"cedar","chats":[{"id":"cedar","title":"Weekly usage","updatedAt":"2026-10-19T00:00:00Z","messages":2}]}"#) { model.apply(event) }
            if let event = try? decodeEvent(#"{"type":"state","state":"idle"}"#) { model.apply(event); model.status.apply(event) }
            model.conversation.replay([ChatLine(fromUser: true, text: "Chart my week and show me the app icon."), ChatLine(fromUser: false, text: reply)])
            save(HelpersView(model: model).frame(width: 1080, height: 1500).environment(\.islandSnapshot, true), name: name, to: directory)
        }
        // A logo drawn as an ```svg block, for any model.
        let logo = """
        Here is a first logo for Cedar: a cedar in a rounded square, with the name beside it.

        ```svg
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 260 120">
          <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3FA272"/><stop offset="1" stop-color="#1A4731"/></linearGradient></defs>
          <rect x="8" y="12" width="96" height="96" rx="24" fill="url(#g)"/>
          <path d="M56 26 L80 58 H68 L88 84 H24 L44 58 H32 Z" fill="#F0FFF4"/>
          <rect x="52" y="84" width="8" height="12" rx="2" fill="#F0FFF4"/>
          <text x="120" y="72" font-family="Helvetica Neue" font-size="34" font-weight="700" fill="#3FA272">Cedar</text>
        </svg>
        ```
        """
        for (name, theme) in [("47-reply-logo-dark", AppTheme.void), ("47-reply-logo-light", AppTheme.daylight)] {
            let suite = "ark.gallery.reply-logo.\(name).\(ProcessInfo.processInfo.processIdentifier)"
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            let model = IslandModel(settings: IslandSettings(defaults: defaults))
            model.settings.theme = theme
            model.status.apply(.running(pid: 1))
            if let event = try? decodeEvent(#"{"type":"chats","current":"cedar","chats":[{"id":"cedar","title":"Cedar logo","updatedAt":"2026-10-19T00:00:00Z","messages":2}]}"#) { model.apply(event) }
            if let event = try? decodeEvent(#"{"type":"state","state":"idle"}"#) { model.apply(event); model.status.apply(event) }
            model.conversation.replay([ChatLine(fromUser: true, text: "Make a logo for Cedar."), ChatLine(fromUser: false, text: logo)])
            save(HelpersView(model: model).frame(width: 1080, height: 820).environment(\.islandSnapshot, true), name: name, to: directory)
        }
        writeSelectText(to: directory)
        writeAgentCursor(to: directory)
    }

    /// 2026-11-02: Select text's page drawn by an offscreen text view (ImageRenderer cannot draw an NSTextView), and what a copy
    /// of all of it holds as HTML: the check that tables and formatting survive.
    private static func writeSelectText(to directory: URL) {
        var chat = Conversation()
        chat.replay([ChatLine(fromUser: true, text: "Compare the plans in a table and chart them."),
                     ChatLine(fromUser: false, text: "Here is **the comparison**, with *notes* and <u>one caveat</u>.\n\n| Plan | Price | Seats |\n|---|---|---|\n| Solo | $10 | 1 |\n| Team | $40 | 5 |\n\n```chart\n{\"type\":\"bar\",\"title\":\"Price per seat\",\"labels\":[\"Solo\",\"Team\"],\"series\":[{\"name\":\"USD\",\"values\":[10,8]}]}\n```\n\n- Solo suits one person.\n- Team saves **20%** per seat."),
                     ChatLine(fromUser: true, text: "Thanks!")])
        let palette = AppTheme.void.palette
        let text = NSTextView(frame: NSRect(x: 0, y: 0, width: 760, height: 10))
        text.textContainerInset = NSSize(width: 24, height: 16)
        text.backgroundColor = NSColor(palette.surfaceSolid.color)
        text.textStorage?.setAttributedString(ChatSelectView.attributed(ChatTranscript.html(chat, style: .init(text: palette.text.hex, muted: palette.text2.hex, rule: palette.text3.hex))))
        text.sizeToFit()
        if let layout = text.layoutManager, let container = text.textContainer {
            layout.ensureLayout(for: container)
            text.setFrameSize(NSSize(width: 760, height: layout.usedRect(for: container).height + 40))
        }
        if let rep = text.bitmapImageRepForCachingDisplay(in: text.bounds) {
            text.cacheDisplay(in: text.bounds, to: rep)
            try? rep.representation(using: .png, properties: [:])?.write(to: directory.appendingPathComponent("48-select-text-dark.png"))
        }
        let all = ChatSelectView.copyable(text.attributedString())
        let html = (try? all.data(from: NSRange(location: 0, length: all.length), documentAttributes: [.documentType: NSAttributedString.DocumentType.html]))
            .flatMap { String(data: $0, encoding: .utf8) } ?? ""
        try? html.write(to: directory.appendingPathComponent("48-select-text-copy.html"), atomically: true, encoding: .utf8)
    }
}
