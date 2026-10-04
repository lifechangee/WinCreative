// core module: shared words (core.common.*), action names (core.action.*), categories, app shell. Keys: 'core.<area>.<name>'.
const dict: Record<string, string> = {
  'core.action.tool.prev': 'Previous tool',
  'core.action.tool.eyedropper': 'Eyedropper (hold)',
  'core.action.tool.eraserHold': 'Eraser (hold)',

  'core.action.nav.pan': 'Pan (hold + drag)',
  'core.action.nav.rotate': 'Rotate (hold + drag)',
  'core.action.nav.zoom': 'Zoom (hold + drag)',

  'core.action.view.zoomIn': 'Zoom in',
  'core.action.view.zoomOut': 'Zoom out',
  'core.action.view.fit': 'Fit canvas to screen',
  'core.action.view.zoom100': 'Zoom to 100%',
  'core.action.view.mirror': 'Flip canvas (mirror the view)',
  'core.action.view.resetRotation': 'Reset rotation',

  'core.action.brush.sizeUp': 'Brush size up',
  'core.action.brush.sizeDown': 'Brush size down',
  'core.action.brush.opacityUp': 'Opacity up',
  'core.action.brush.opacityDown': 'Opacity down',

  'core.action.edit.undo': 'Undo',
  'core.action.edit.redo': 'Redo',

  'core.action.layer.new': 'New layer',
  'core.action.layer.delete': 'Delete layer',
  'core.action.layer.duplicate': 'Duplicate layer',
  'core.action.layer.clear': 'Clear layer',

  'core.action.ui.layers': 'Layers panel',
  'core.action.ui.color': 'Color panel',
  'core.action.ui.brushLibrary': 'Brush library',
  'core.action.ui.hideUI': 'Hide / show interface',
  'core.action.ui.fullscreen': 'Full screen',
  'core.action.ui.theme': 'Toggle light / dark interface',

  'core.action.tool.brush': 'Paint tool',
  'core.action.tool.smudge': 'Smudge tool',
  'core.action.tool.eraser': 'Eraser tool',

  'core.action.edit.cut': 'Cut',
  'core.action.edit.copy': 'Copy',
  'core.action.edit.paste': 'Paste',
  'core.action.edit.pasteMenu': 'Copy & Paste menu',

  'core.action.select.all': 'Select all',
  'core.action.select.deselect': 'Deselect',
  'core.action.select.invert': 'Invert selection',

  'core.action.transform': 'Transform',
  'core.action.transform.flipH': 'Flip horizontal',
  'core.action.transform.flipV': 'Flip vertical',

  'core.action.layer.merge': 'Merge layer down',

  'core.action.file.save': 'Save',
  'core.action.file.open': 'Open',
  'core.action.file.new': 'New canvas',

  'core.action.unavailable': '{name} is not available',

  'core.app.startFailed': 'WinCreative failed to start:',

  'core.toast.lastLayer': 'Cannot delete the last layer',

  'core.toast.layerLocked': 'Layer is locked',

  'core.toast.layerCleared': 'Layer cleared',

  'core.category.File': 'File',

  'core.category.Color': 'Color',

  'core.category.Interface': 'Interface',

  'core.category.View': 'View',

  'core.category.Tools': 'Tools',

  'core.category.Navigation': 'Navigation',

  'core.category.Brush': 'Brush',

  'core.category.Edit': 'Edit',

  'core.category.Layers': 'Layers',

  'core.category.Selection': 'Selection',

  'core.category.Menus': 'Menus',

  'core.common.ok': 'OK',

  'core.common.cancel': 'Cancel',

  'core.common.done': 'Done',

  'core.common.close': 'Close',

  'core.common.save': 'Save',

  'core.common.create': 'Create',

  'core.common.delete': 'Delete',

  'core.common.apply': 'Apply',

  'core.common.reset': 'Reset',

  'core.common.add': 'Add',

  'core.common.remove': 'Remove',

  'core.common.rename': 'Rename',

  'core.common.duplicate': 'Duplicate',

  'core.common.yes': 'Yes',

  'core.common.no': 'No',

  'core.common.open': 'Open',

  'core.common.import': 'Import',

  'core.common.export': 'Export',

  'core.common.none': 'None',

  'core.common.on': 'On',

  'core.common.off': 'Off',

  'core.common.back': 'Back',

  'core.common.next': 'Next',

  'core.common.confirm': 'Confirm',

  'core.common.name': 'Name',

  'core.common.untitled': 'Untitled',

  'core.common.error': 'Error',

  'core.common.loading': 'Loading...',

  'core.common.copy': 'Copy',

  'core.common.paste': 'Paste',

  'core.common.select': 'Select',

  'core.common.more': 'More',

  'core.common.opacity': 'Opacity',

  'core.common.size': 'Size',

  'core.tool.layerHidden': 'Layer is hidden',

  'core.tool.selectInGroup': 'Select a layer inside the group to paint',

  'core.doc.background': 'Background',

  'core.doc.layerProperties': 'Layer properties',

  'core.color.srgb': 'sRGB IEC61966-2.1',

  'core.color.p3': 'Display P3',

  'core.color.adobe': 'Adobe RGB (1998)',
  'core.history.new_document': 'New document',
  'core.history.open_document': 'Open document',
  'core.history.import_psd': 'Import PSD',
  'core.history.import_image': 'Import image',
  'core.history.import_procreate': 'Import Procreate',
  'core.history.crop_and_resize': 'Crop and resize',
  'core.history.add_layer': 'Add layer',
  'core.history.add_mask': 'Add mask',
  'core.history.delete_mask': 'Delete mask',
  'core.history.delete_layer': 'Delete layer',
  'core.history.delete_group': 'Delete group',
  'core.history.delete_layers': 'Delete layers',
  'core.history.duplicate_layer': 'Duplicate layer',
  'core.history.duplicate_group': 'Duplicate group',
  'core.history.duplicate': 'Duplicate',
  'core.history.clear_layer': 'Clear layer',
  'core.history.reorder_layer': 'Reorder layer',
  'core.history.group_layers': 'Group layers',
  'core.history.ungroup': 'Ungroup',
  'core.history.set_reference': 'Set reference',
  'core.history.clear_reference': 'Clear reference',
  'core.history.add_frame': 'Add frame',
  'core.history.add_page': 'Add page',
  'core.history.insert_image': 'Insert image',
  'core.history.insert_psd': 'Insert PSD',
  'core.history.flip': 'Flip',
  'core.history.flip_canvas_horizontal': 'Flip canvas horizontal',
  'core.history.flip_canvas_vertical': 'Flip canvas vertical',
  'core.history.clear_mask': 'Clear mask',
  'core.history.reveal_all': 'Reveal all',
  'core.history.cut_paste': 'Cut & paste',
  'core.history.copy_paste': 'Copy & paste',
  'core.history.flatten': 'Flatten',
  'core.history.merge_group': 'Merge group',
  'core.history.merge_layers': 'Merge layers',
  'core.history.merge_down': 'Merge down',
  'core.history.combine_down': 'Combine down',
  'core.history.apply_mask': 'Apply mask',
  'core.history.fill_mask': 'Fill mask',
  'core.history.fill_layer': 'Fill layer',
  'core.history.invert_mask': 'Invert mask',
  'core.history.invert_colors': 'Invert colors',
  'core.history.convert_profile': 'Convert profile',
  'core.history.convert_colour_profile': 'Convert colour profile',
  'core.history.psd_adjustment_layers': 'PSD adjustment layers',
  'core.history.cut': 'Cut',
  'core.history.paste': 'Paste',
  'core.history.transform': 'Transform',
  'core.history.transform_selection': 'Transform selection',
  'core.history.brush_stroke': 'Brush stroke',
  'core.history.smudge': 'Smudge',
  'core.history.erase': 'Erase',
  'core.history.selection': 'Selection',
  'core.history.deselect': 'Deselect',
  'core.history.select_all': 'Select all',
  'core.history.invert_selection': 'Invert selection',
  'core.history.load_selection': 'Load selection',
  'core.history.clear_selection': 'Clear selection',
  'core.history.select_layer': 'Select layer',
  'core.history.select_layer_contents': 'Select layer contents',
  'core.history.color_fill': 'Color fill',
  'core.history.invert': 'Invert',
  'core.history.desaturate': 'Desaturate',
  'core.history.brighten_15': 'Brighten +15%',
  'core.history.background': 'Background',
  'core.history.layer_properties': 'Layer properties',
  'core.doc.layer': 'Layer',
  'core.doc.layerN': 'Layer {n}',
  'core.doc.group': 'Group',
  'core.doc.copySuffix': ' copy',
  'core.doc.cutSuffix': ' cut',
  'core.doc.frameN': 'Frame {n}',
  'core.doc.pageN': 'Page {n}',
  'core.doc.pastedImage': 'Pasted image',
  'core.doc.pastedLayer': 'Pasted layer',
  'core.blendGroup.Normal': 'Normal',
  'core.blendGroup.Darken': 'Darken',
  'core.blendGroup.Lighten': 'Lighten',
  'core.blendGroup.Contrast': 'Contrast',
  'core.blendGroup.Comparative': 'Comparative',
  'core.blendGroup.Component': 'Component',
  'core.blend.normal': 'Normal',
  'core.blend.multiply': 'Multiply',
  'core.blend.screen': 'Screen',
  'core.blend.overlay': 'Overlay',
  'core.blend.softLight': 'Soft Light',
  'core.blend.hardLight': 'Hard Light',
  'core.blend.colorDodge': 'Color Dodge',
  'core.blend.colorBurn': 'Color Burn',
  'core.blend.darken': 'Darken',
  'core.blend.lighten': 'Lighten',
  'core.blend.difference': 'Difference',
  'core.blend.exclusion': 'Exclusion',
  'core.blend.add': 'Add',
  'core.blend.hue': 'Hue',
  'core.blend.saturation': 'Saturation',
  'core.blend.color': 'Color',
  'core.blend.luminosity': 'Luminosity',
  'core.blend.linearBurn': 'Linear Burn',
  'core.blend.darkerColor': 'Darker Color',
  'core.blend.lighterColor': 'Lighter Color',
  'core.blend.vividLight': 'Vivid Light',
  'core.blend.linearLight': 'Linear Light',
  'core.blend.pinLight': 'Pin Light',
  'core.blend.hardMix': 'Hard Mix',
  'core.blend.subtract': 'Subtract',
  'core.blend.divide': 'Divide',
  'core.history.feather_selection': 'Feather selection',
  'core.toast.viewFlipped': 'Canvas view flipped',
  'core.toast.viewRestored': 'Canvas view restored',
  'core.hover.opacity': 'Opacity {n}%',
  'core.hover.size': 'Size {n}',
  'core.doc.image': 'Image',
  'core.filter.png': 'PNG image',
  'core.filter.jpeg': 'JPEG image',
  'core.filter.invert': 'Invert',
  'core.filter.desaturate': 'Desaturate',
  'core.filter.brightness': 'Brighten +15%',
  'core.history.select_color_area': 'Select color area',
  'core.history.select_rectangle': 'Select rectangle',
  'core.history.select_ellipse': 'Select ellipse',
  'core.history.select_freehand': 'Select freehand',
}
export default dict
