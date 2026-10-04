// ui module: top bar, sidebar, popover host, new canvas dialog. Keys: 'ui.<area>.<name>'.
const dict: Record<string, string> = {
  'ui.menu.gallery': 'Gallery',

  'ui.menu.actions': 'Actions',

  'ui.menu.adjustments': 'Adjustments',

  'ui.menu.selection': 'Selection',

  'ui.menu.transform': 'Transform',

  'ui.menu.group.add': 'Add',
  'ui.menu.group.video': 'Video',
  'ui.menu.group.canvas': 'Canvas',
  'ui.menu.group.share': 'Share',

  'ui.menu.empty': 'Nothing here yet',

  'ui.menu.new': 'New canvas...',

  'ui.menu.open': 'Open .bwk...',

  'ui.menu.save': 'Save .bwk...',

  'ui.menu.exportPng': 'Export PNG (transparent)',

  'ui.menu.exportPngBg': 'Export PNG (with background)',

  'ui.menu.exportJpg': 'Export JPG',

  'ui.menu.fit': 'Fit canvas to screen',

  'ui.menu.resetRotation': 'Reset rotation',

  'ui.stub.rectangle': 'Rectangle (coming soon)',

  'ui.stub.freehand': 'Freehand (coming soon)',

  'ui.stub.automatic': 'Automatic (coming soon)',

  'ui.stub.freeform': 'Freeform (coming soon)',

  'ui.stub.flipH': 'Flip horizontal (coming soon)',

  'ui.stub.flipV': 'Flip vertical (coming soon)',

  'ui.panel.color': 'Color',

  'ui.panel.colour': 'Colour',

  'ui.panel.layers': 'Layers',

  'ui.panel.lib.brush': 'Brush library',
  'ui.panel.lib.smudge': 'Smudge library',
  'ui.panel.lib.eraser': 'Eraser library',

  'ui.tool.brush': 'Brush (B)',

  'ui.tool.smudge': 'Smudge (S)',

  'ui.tool.eraser': 'Eraser (E)',

  'ui.toast.saved': 'Saved',

  'ui.toast.saveFailed': 'Save failed: {error}',

  'ui.toast.opened': 'Opened',

  'ui.toast.openFailed': 'Open failed: {error}',

  'ui.toast.exported': 'Exported',

  'ui.sidebar.fine': 'fine x{factor}',

  'ui.sidebar.brushSize': 'Brush size',

  'ui.sidebar.brushOpacity': 'Brush opacity',

  'ui.sidebar.modifyTip': 'Modify (hold): {action}',

  'ui.sidebar.modifyNone': 'none',

  'ui.sidebar.undo': 'Undo (Ctrl+Z)',

  'ui.sidebar.redo': 'Redo (Ctrl+Shift+Z)',

  'ui.sidebar.grip': 'Drag to move sidebar',

  'ui.unit.px': 'px',

  'ui.unit.in': 'in',

  'ui.unit.cm': 'cm',

  'ui.unit.mm': 'mm',

  'ui.newdoc.title': 'New canvas',

  'ui.newdoc.defaultName': 'Untitled canvas',

  'ui.newdoc.preset.screen': 'Screen Size',
  'ui.newdoc.preset.square': 'Square 2048',
  'ui.newdoc.preset.4k': '4K UHD',
  'ui.newdoc.preset.a4': 'A4 300 dpi',
  'ui.newdoc.preset.photo': '4x6 Photo 300 dpi',
  'ui.newdoc.preset.hd': 'Full HD',

  'ui.newdoc.sizeRange': 'Size must be 16 to {max} px',

  'ui.newdoc.info': '{w} x {h} px · max {layers} layers · {mp} MP',

  'ui.newdoc.presetDelete': 'Right-click to delete',

  'ui.newdoc.savePreset': 'Save canvas preset',

  'ui.newdoc.createFailed': 'Could not create canvas: {error}',

  'ui.newdoc.width': 'Width',

  'ui.newdoc.height': 'Height',

  'ui.newdoc.units': 'Units',

  'ui.newdoc.dpi': 'DPI',

  'ui.newdoc.colour': 'Colour',

  'ui.newdoc.background': 'Background',

  'ui.newdoc.transparent': 'Transparent',

  'ui.newdoc.saveAsPreset': 'Save as preset...',

  'ui.newdoc.tl.Max': 'Time-lapse: Max',
  'ui.newdoc.tl.HD': 'Time-lapse: HD',
  'ui.newdoc.tl.Small': 'Time-lapse: Small',
}
export default dict
