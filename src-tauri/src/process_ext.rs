use std::process::Command;

/// Configure a Command so it doesn't flash a console window on Windows when
/// spawned by a GUI process. No-op on other platforms.
pub fn hide_window(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
