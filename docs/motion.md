# Motion

The active native interface animates only the `city`, `dreams`, and `tunnel` cover patterns. The Appearance setting `Animate cover patterns` controls those effects; it defaults on for existing and new settings files. No editor, panel, or graph transitions are added, so navigation and editing actions remain immediate.

On macOS, the native interface also disables cover animation when `NSWorkspace.accessibilityDisplayShouldReduceMotion` is enabled. Other platforms currently rely on the Appearance setting because Masonry and winit do not expose a shared reduced-motion preference. The system preference is read when a cover is created.
