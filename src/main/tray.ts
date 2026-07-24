import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron'

let tray: Tray | null = null

// Generate a 16x16 blue pixel icon as PNG buffer
function createDefaultIcon(): Electron.NativeImage {
  // Minimal valid 1x1 blue PNG, scaled up by Electron
  const pngBuffer = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x08, 0xd7, 0x63, 0xd8, 0xcd, 0xc0, 0x00, // compressed blue pixel
    0x00, 0x00, 0x04, 0x00, 0x01, 0xf6, 0x17, 0xa4, // checksum
    0x49, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
    0x44, 0xae, 0x42, 0x60, 0x82
  ])
  return nativeImage.createFromBuffer(pngBuffer).resize({ width: 16, height: 16 })
}

export function createTray(mainWindow: BrowserWindow): Tray {
  const icon = createDefaultIcon()
  tray = new Tray(icon)
  tray.setToolTip('临智 LINZ')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '打开主窗口',
      click: (): void => {
        mainWindow.show()
        mainWindow.focus()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: (): void => {
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)

  tray.on('double-click', () => {
    mainWindow.show()
    mainWindow.focus()
  })

  return tray
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}
