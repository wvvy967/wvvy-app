/*
  Press a button in Device Hub's window for one simulator.

    devicehub <window title prefix> <button>
    devicehub "iPhone Duo" Open
    devicehub "iPhone Duo" "Rotate Right"

  Exists for the iPhone Duo, whose pose — Closed, Partially Open, Open — decides
  which of its two displays is live. simctl has no pose command; Device Hub,
  the app that replaced Simulator.app in Xcode 27, has the three as buttons
  beside the device, and nothing else exposes them. capture.mjs compiles this
  on first use and runs it before each Duo set.

  It goes through the accessibility API directly rather than AppleScript's
  System Events: measured October 2026, Device Hub reports no windows and no
  attributes at all to System Events, but answers an AXUIElement walk in full.
  The terminal running the capture needs the Accessibility permission (System
  Settings → Privacy & Security), the same as any UI scripting.

  Exits non-zero, saying why, when Device Hub is not running or the window or
  button is not there — a silent no-op would photograph the wrong display.
*/

import ApplicationServices
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else {
  FileHandle.standardError.write("usage: devicehub <window title prefix> <button>\n".data(using: .utf8)!)
  exit(2)
}
let windowPrefix = args[1]
let buttonName = args[2]

/*
  More than one Xcode can have its Device Hub open; the window could be in any.
  Found with pgrep rather than NSRunningApplication, which from a command-line
  tool lists Device Hub but reports its processIdentifier as -1.
*/
func deviceHubPids() -> [pid_t] {
  let pgrep = Process()
  pgrep.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
  pgrep.arguments = ["-x", "DeviceHub"]
  let out = Pipe()
  pgrep.standardOutput = out
  try? pgrep.run()
  pgrep.waitUntilExit()
  let text = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  return text.split(separator: "\n").compactMap { pid_t($0.trimmingCharacters(in: .whitespaces)) }
}
let hubs = deviceHubPids()
guard !hubs.isEmpty else {
  FileHandle.standardError.write("Device Hub is not running\n".data(using: .utf8)!)
  exit(1)
}

func attribute(_ element: AXUIElement, _ name: String) -> AnyObject? {
  var value: AnyObject?
  return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func children(_ element: AXUIElement) -> [AXUIElement] {
  (attribute(element, "AXChildren") as? [AXUIElement]) ?? []
}

/// The first button described as `name` under `element`, depth first.
func button(named name: String, in element: AXUIElement, depth: Int = 0) -> AXUIElement? {
  if depth > 20 { return nil }
  if attribute(element, "AXRole") as? String == "AXButton", attribute(element, "AXDescription") as? String == name {
    return element
  }
  for child in children(element) {
    if let found = button(named: name, in: child, depth: depth + 1) { return found }
  }
  return nil
}

// AXWindows can come back empty while the windows are there as children.
let windows = hubs.flatMap { pid -> [AXUIElement] in
  let app = AXUIElementCreateApplication(pid)
  let listed = (attribute(app, "AXWindows") as? [AXUIElement]) ?? []
  return listed.isEmpty ? children(app).filter { attribute($0, "AXRole") as? String == "AXWindow" } : listed
}
let matching = windows.filter { (attribute($0, "AXTitle") as? String ?? "").hasPrefix(windowPrefix) }
guard !matching.isEmpty else {
  let titles = windows.compactMap { attribute($0, "AXTitle") as? String }
  FileHandle.standardError.write("no Device Hub window titled \"\(windowPrefix)…\" (open: \(titles))\n".data(using: .utf8)!)
  exit(1)
}
/*
  The first window that has the button, not the first with the title. Opening
  "Simulator" can launch a newer Xcode's Device Hub beside this one — measured
  October 2026, a 27.2 beta — which shows the same device in a window of its
  own with no pose buttons, because that release cannot fold a Duo.
*/
guard let target = matching.lazy.compactMap({ button(named: buttonName, in: $0) }).first else {
  FileHandle.standardError.write("no \"\(buttonName)\" button in any \(windowPrefix) window (\(matching.count) open)\n".data(using: .utf8)!)
  exit(1)
}
let result = AXUIElementPerformAction(target, kAXPressAction as CFString)
guard result == .success else {
  FileHandle.standardError.write("pressing \"\(buttonName)\" failed (AXError \(result.rawValue))\n".data(using: .utf8)!)
  exit(1)
}
