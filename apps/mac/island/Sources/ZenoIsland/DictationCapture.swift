import AVFoundation
import CoreAudio
import Foundation
import ZenoIslandCore

/// Low-latency microphone capture for dictation (ADR-047).
///
/// The input device is *prepared* ahead of time (a Core Audio IOProc is registered but no audio flows, so the
/// microphone indicator is off) and only started when the shortcut is held. In a spike on this Mac, starting
/// a prepared Core Audio device delivered the first samples after about 60 ms, against about 165 ms for
/// AVAudioEngine. Nothing is kept from before the key was pressed.
///
/// Output is 16 kHz mono Float32, the format the speech model wants. Thread safety: `lock` guards the state;
/// it is never held while calling into Core Audio (`AudioDeviceStop` waits for the audio callback, which takes
/// the same lock).
final class DictationCapture: @unchecked Sendable {
    enum CaptureError: Error, CustomStringConvertible {
        case noInputDevice
        case unsupportedFormat(String)
        case couldNotStart(OSStatus)

        var description: String {
            switch self {
            case .noInputDevice: "No microphone is available. Connect one or choose it in System Settings → Sound → Input."
            case .unsupportedFormat(let detail): "The microphone's audio format is not supported (\(detail))."
            case .couldNotStart(let status): "The microphone could not be started (Core Audio error \(status))."
            }
        }
    }

    private let lock = NSLock()
    private var device: AudioDeviceID = 0
    private var procID: AudioDeviceIOProcID?
    private var converter: AVAudioConverter?
    private var monoFormat: AVAudioFormat?
    private var channels = 1
    private var capturing = false
    /// Asleep or locked (ADR-076): a device change does not prepare the new device; resuming does.
    private var suspended = false
    private var samples: [Float] = []
    private var sinceLevel = 0
    private var levelPeak: Float = 0
    private var levelEvery = 800
    private var deviceListener: AudioObjectPropertyListenerBlock?
    private let queue = DispatchQueue(label: "dev.zeno.dictation.capture", qos: .userInteractive)

    static let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!

    /// Peak level 0–1, about 20 times a second while capturing. Called on the capture queue.
    var onLevel: (@Sendable (Float) -> Void)?
    /// Something about the device changed or failed (for the log).
    var onEvent: (@Sendable (String) -> Void)?

    /// Microphone permission, as macOS reports it.
    static var permission: AVAuthorizationStatus { AVCaptureDevice.authorizationStatus(for: .audio) }

    static func requestPermission() async -> Bool {
        await AVCaptureDevice.requestAccess(for: .audio)
    }

    deinit { teardown() }

    // MARK: - Prepared device

    /// Registers the default input device so `start()` is quick. Safe to call again (it follows device changes).
    @discardableResult
    func prepare() -> CaptureError? {
        teardown()
        let id = Self.defaultInputDevice()
        guard id != 0 else { return .noInputDevice }
        guard let stream = Self.inputFormat(of: id) else { return .unsupportedFormat("no input stream") }
        let asbd = stream
        guard asbd.mFormatID == kAudioFormatLinearPCM, asbd.mFormatFlags & kAudioFormatFlagIsFloat != 0, asbd.mBitsPerChannel == 32
        else { return .unsupportedFormat("not 32-bit float") }
        let interleaved = asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved == 0
        guard interleaved else { return .unsupportedFormat("non-interleaved input") }
        guard let mono = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: asbd.mSampleRate, channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: mono, to: Self.target)
        else { return .unsupportedFormat("\(Int(asbd.mSampleRate)) Hz") }

        var proc: AudioDeviceIOProcID?
        let status = AudioDeviceCreateIOProcIDWithBlock(&proc, id, queue) { [weak self] _, input, _, _, _ in
            self?.received(input)
        }
        guard status == noErr, let proc else { return .couldNotStart(status) }

        lock.lock()
        device = id
        procID = proc
        self.converter = converter
        monoFormat = mono
        channels = max(1, Int(asbd.mChannelsPerFrame))
        levelEvery = Int(asbd.mSampleRate / 20) // 20 level updates a second
        lock.unlock()
        listenForDeviceChange()
        return nil
    }

    private func teardown() {
        lock.lock()
        let id = device, proc = procID
        let listener = deviceListener
        deviceListener = nil
        device = 0
        procID = nil
        capturing = false
        converter = nil
        lock.unlock()
        if let listener {
            var address = Self.defaultInputAddress()
            AudioObjectRemovePropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, listener)
        }
        if id != 0, let proc {
            AudioDeviceStop(id, proc)
            AudioDeviceDestroyIOProcID(id, proc)
        }
    }

    /// When the default microphone changes (headphones connected, a camera unplugged), prepare the new one.
    private func listenForDeviceChange() {
        guard deviceListener == nil else { return }
        let block: AudioObjectPropertyListenerBlock = { [weak self] _, _ in
            guard let self else { return }
            self.lock.lock()
            let busy = self.capturing || self.suspended
            self.lock.unlock()
            if busy { return } // the next dictation (or resuming) prepares again
            let problem = self.prepare()
            self.onEvent?("capture.device_changed" + (problem.map { " (\($0))" } ?? ""))
        }
        var address = Self.defaultInputAddress()
        AudioObjectAddPropertyListenerBlock(AudioObjectID(kAudioObjectSystemObject), &address, .main, block)
        lock.lock()
        deviceListener = block
        lock.unlock()
    }

    func setSuspended(_ suspended: Bool) {
        lock.lock()
        self.suspended = suspended
        lock.unlock()
    }

    // MARK: - Recording

    /// Starts capturing. Throws if the microphone cannot be started.
    func start() throws {
        lock.lock()
        let missing = procID == nil
        lock.unlock()
        if missing, let problem = prepare() { throw problem }

        lock.lock()
        samples.removeAll(keepingCapacity: true)
        samples.reserveCapacity(16_000 * 30)
        sinceLevel = 0
        levelPeak = 0
        capturing = true
        let id = device, proc = procID
        lock.unlock()

        guard let proc else { throw CaptureError.noInputDevice }
        let status = AudioDeviceStart(id, proc)
        if status != noErr {
            lock.lock(); capturing = false; lock.unlock()
            // The device may have gone away since it was prepared: prepare again once.
            if prepare() == nil, let again = procID {
                lock.lock(); capturing = true; lock.unlock()
                let retry = AudioDeviceStart(device, again)
                if retry == noErr { return }
                lock.lock(); capturing = false; lock.unlock()
                throw CaptureError.couldNotStart(retry)
            }
            throw CaptureError.couldNotStart(status)
        }
    }

    /// Stops capturing and returns what was heard. The device stays prepared for the next time.
    func stop() -> [Float] {
        lock.lock()
        let wasCapturing = capturing
        capturing = false // the audio callback ignores anything that arrives from now on
        let id = device, proc = procID
        lock.unlock()
        if wasCapturing, let proc { AudioDeviceStop(id, proc) } // not under the lock: it waits for the callback

        lock.lock()
        let clip = samples
        samples.removeAll(keepingCapacity: false)
        lock.unlock()
        return clip
    }

    /// Stops and throws away what was heard.
    func cancel() { _ = stop() }

    /// What has been heard so far without stopping: how many samples there are in all, and the last
    /// `maxSamples` of them. Used for the live preview.
    func snapshot(maxSamples: Int) -> (total: Int, clip: [Float]) {
        lock.lock()
        defer { lock.unlock() }
        return (samples.count, Array(samples.suffix(maxSamples)))
    }

    /// Releases the device for good (quitting).
    func cleanup() { teardown() }

    // MARK: - Audio callback (capture queue)

    private func received(_ list: UnsafePointer<AudioBufferList>) {
        lock.lock()
        let active = capturing
        let converter = converter, mono = monoFormat, channelCount = channels
        lock.unlock()
        guard active, let converter, let mono else { return }

        let buffers = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: list))
        guard let buffer = buffers.first, let data = buffer.mData?.assumingMemoryBound(to: Float.self), buffer.mDataByteSize > 0
        else { return }
        let frames = Int(buffer.mDataByteSize) / (MemoryLayout<Float>.size * channelCount)
        guard frames > 0, let input = AVAudioPCMBuffer(pcmFormat: mono, frameCapacity: AVAudioFrameCount(frames)),
              let out = input.floatChannelData?[0]
        else { return }
        input.frameLength = AVAudioFrameCount(frames)

        // Interleaved input: average the channels into one.
        if channelCount == 1 {
            out.update(from: data, count: frames)
        } else {
            let scale = 1 / Float(channelCount)
            for frame in 0..<frames {
                var sum: Float = 0
                for channel in 0..<channelCount { sum += data[frame * channelCount + channel] }
                out[frame] = sum * scale
            }
        }

        let capacity = AVAudioFrameCount(Double(frames) * Self.target.sampleRate / mono.sampleRate) + 32
        guard let resampled = AVAudioPCMBuffer(pcmFormat: Self.target, frameCapacity: capacity) else { return }
        var supplied = false
        var failure: NSError?
        let status = converter.convert(to: resampled, error: &failure) { _, outStatus in
            if supplied { outStatus.pointee = .noDataNow; return nil }
            supplied = true
            outStatus.pointee = .haveData
            return input
        }
        guard status != .error, resampled.frameLength > 0, let samples16 = resampled.floatChannelData?[0] else {
            if let failure { onEvent?("capture.resample_failed \(failure.localizedDescription)") }
            return
        }
        let chunk = Array(UnsafeBufferPointer(start: samples16, count: Int(resampled.frameLength)))
        var peak: Float = 0
        for value in chunk { peak = max(peak, abs(value)) }

        lock.lock()
        guard capturing else { lock.unlock(); return } // stopped while converting
        samples.append(contentsOf: chunk)
        levelPeak = max(levelPeak, peak)
        sinceLevel += frames
        var report: Float?
        if sinceLevel >= levelEvery {
            report = levelPeak
            levelPeak = 0
            sinceLevel = 0
        }
        lock.unlock()
        if let report { onLevel?(report) }
    }

    // MARK: - Core Audio

    private static func defaultInputAddress() -> AudioObjectPropertyAddress {
        AudioObjectPropertyAddress(
            mSelector: kAudioHardwarePropertyDefaultInputDevice,
            mScope: kAudioObjectPropertyScopeGlobal,
            mElement: kAudioObjectPropertyElementMain)
    }

    static func defaultInputDevice() -> AudioDeviceID {
        var id = AudioDeviceID(0)
        var size = UInt32(MemoryLayout<AudioDeviceID>.size)
        var address = defaultInputAddress()
        let status = AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &address, 0, nil, &size, &id)
        return status == noErr ? id : 0
    }

    private static func inputFormat(of device: AudioDeviceID) -> AudioStreamBasicDescription? {
        var asbd = AudioStreamBasicDescription()
        var size = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var address = AudioObjectPropertyAddress(
            mSelector: kAudioDevicePropertyStreamFormat,
            mScope: kAudioObjectPropertyScopeInput,
            mElement: kAudioObjectPropertyElementMain)
        let status = AudioObjectGetPropertyData(device, &address, 0, nil, &size, &asbd)
        return status == noErr && asbd.mSampleRate > 0 && asbd.mChannelsPerFrame > 0 ? asbd : nil
    }
}
