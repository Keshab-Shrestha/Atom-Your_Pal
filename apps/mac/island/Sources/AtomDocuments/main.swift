import Foundation
import PDFKit
import Darwin

// Private extraction helper. No paths, Office importer, links, attachments, model or app-control capabilities.
private let maxInput = 8 * 1024 * 1024
private let maxText = 256 * 1024
private enum ReaderError: Error { case invalid }

private final class WordText: NSObject, XMLParserDelegate {
    var text = ""
    private var takingText = false
    private var depth = 0
    private var bytes = 0
    private let namespaces = ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"]
    private func append(_ value: String, parser: XMLParser) {
        bytes += value.utf8.count
        guard bytes <= maxText else { parser.abortParsing(); return }
        text += value
    }
    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?, attributes: [String: String]) {
        depth += 1
        guard depth <= 64 else { parser.abortParsing(); return }
        guard namespaces.contains(namespaceURI ?? "") else { return }
        if name == "t" { takingText = true }
        if name == "tab" { append("\t", parser: parser) }
        if name == "br" || name == "cr" { append("\n", parser: parser) }
    }
    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if takingText { append(string, parser: parser) }
    }
    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        depth -= 1
        guard namespaces.contains(namespaceURI ?? "") else { return }
        if name == "t" { takingText = false }
        if name == "p" { append("\n", parser: parser) }
    }
}

do {
    var cpu = rlimit(rlim_cur: 3, rlim_max: 3)
    _ = setrlimit(RLIMIT_CPU, &cpu)
    var data = Data()
    while data.count <= maxInput {
        guard let chunk = try FileHandle.standardInput.read(upToCount: min(64 * 1024, maxInput + 1 - data.count)), !chunk.isEmpty else { break }
        data.append(chunk)
    }
    guard !data.isEmpty, data.count <= maxInput else { throw ReaderError.invalid }
    let text: String
    switch CommandLine.arguments.dropFirst().first {
    case "pdf":
        guard data.starts(with: Data("%PDF-".utf8)), let pdf = PDFDocument(data: data), !pdf.isEncrypted,
              pdf.pageCount > 0, pdf.pageCount <= 100 else { throw ReaderError.invalid }
        var result = "", bytes = 0
        for page in 0..<pdf.pageCount {
            let part = (pdf.page(at: page)?.string ?? "") + "\n"
            bytes += part.utf8.count
            guard bytes <= maxText else { throw ReaderError.invalid }
            result += part
        }
        text = result
    case "word-xml":
        guard data.count <= 1024 * 1024, let xml = String(data: data, encoding: .utf8),
              !xml.contains("<!DOCTYPE"), !xml.contains("<!ENTITY") else { throw ReaderError.invalid }
        let reader = WordText(), parser = XMLParser(data: data)
        parser.shouldProcessNamespaces = true
        parser.shouldResolveExternalEntities = false
        parser.externalEntityResolvingPolicy = .never
        parser.delegate = reader
        guard parser.parse() else { throw ReaderError.invalid }
        text = reader.text
    default: throw ReaderError.invalid
    }
    guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.utf8.count <= maxText else { throw ReaderError.invalid }
    let result = try JSONSerialization.data(withJSONObject: ["text": text])
    FileHandle.standardOutput.write(result)
} catch {
    FileHandle.standardOutput.write(Data("{\"error\":\"No readable text within the document budget.\"}".utf8))
    exit(1)
}
