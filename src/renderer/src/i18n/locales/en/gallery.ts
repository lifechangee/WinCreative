// gallery module strings (en). Keys: 'gallery.<area>.<name>'.
const dict: Record<string, string> = {
  // Panel title
  'gallery.panel.title': 'Gallery',

  // Main bar
  'gallery.bar.search': 'Search',
  'gallery.bar.sort': 'Sort: ',
  'gallery.sort.manual': 'Manual',
  'gallery.sort.newest': 'Newest',
  'gallery.sort.oldest': 'Oldest',
  'gallery.sort.name': 'Name',

  // Import/Export actions
  'gallery.action.import': 'Import image / file…',

  // Toast messages
  'gallery.toast.saved': 'Saved',
  'gallery.toast.exported': 'Exported',
  'gallery.toast.imported': 'Imported',
  'gallery.toast.duplicated': 'Duplicated',
  'gallery.toast.renamed': 'Renamed',

  // Dialog titles and labels
  'gallery.dialog.rename': 'Rename',
  'gallery.dialog.share': 'Share "{name}"',
  'gallery.dialog.delete': 'Delete artwork',
  'gallery.dialog.renameStack': 'Rename stack',

  // Dialog buttons
  'gallery.dialog.cancel': 'Cancel',
  'gallery.dialog.close': 'Close',
  'gallery.dialog.open': 'Open',
  'gallery.dialog.restore': 'Restore',
  'gallery.dialog.deleteForever': 'Delete forever',

  // Trash and recovery
  'gallery.trash.empty': 'The Recycle Bin is empty',
  'gallery.trash.deleted': 'Deleted {date}',

  // Card actions
  'gallery.card.preview': 'Preview',
  'gallery.card.share': 'Share…',
  'gallery.card.duplicate': 'Duplicate',
  'gallery.card.removeFromStack': 'Remove from stack',
  'gallery.card.delete': 'Delete',
  'gallery.card.ungroup': 'Ungroup',
  'gallery.card.rename': 'Rename…',
  'gallery.card.clickToRename': 'Click to rename',

  // Stack/context menu
  'gallery.menu.open': 'Open',
  'gallery.menu.rename': 'Rename…',
  'gallery.menu.preview': 'Preview',
  'gallery.menu.share': 'Share…',
  'gallery.menu.duplicate': 'Duplicate',
  'gallery.menu.removeFromStack': 'Remove from stack',
  'gallery.menu.delete': 'Delete',
  'gallery.menu.ungroup': 'Ungroup',

  // Share format dialog
  'gallery.share.format': 'Share "{name}"',
  'gallery.share.bwk': 'WinCreative (.bwk)',
  'gallery.share.png': 'PNG',
  'gallery.share.jpg': 'JPG',

  // Errors
  'gallery.error.openFailed': 'Open failed: ',
  'gallery.error.importFailed': 'Import failed: ',
  'gallery.error.shareFailed': 'Share failed: ',
  'gallery.error.duplicateFailed': 'Duplicate failed: ',
  'gallery.error.filesMissing': 'Artwork file is missing',

  // Recovered strokes
  'gallery.trash.confirmOne': 'Move "{name}" to the Recycle Bin? You can restore it later.',
  'gallery.trash.confirmMany_one': 'Move {count} artwork to the Recycle Bin?',
  'gallery.trash.confirmMany_few': 'Move {count} artworks to the Recycle Bin?',
  'gallery.trash.confirmMany_many': 'Move {count} artworks to the Recycle Bin?',
  'gallery.trash.confirmMany_other': 'Move {count} artworks to the Recycle Bin?',
  'gallery.filter.doc': 'WinCreative document',
  'gallery.filter.everything': 'Everything WinCreative can import',
  'gallery.filter.images': 'Artwork and images',
  'gallery.filter.resources': 'Brushes, fonts, palettes',
  'gallery.filter.all': 'All files',
  'gallery.stack.default': 'Stack',
  'gallery.info.size': 'Size',
  'gallery.info.layers': 'Layers',
  'gallery.info.profile': 'Colour profile',
  'gallery.info.created': 'Created',
  'gallery.info.modified': 'Modified',
  'gallery.card.metaItem_one': '{w} × {h} · {count} layer',
  'gallery.card.metaItem_few': '{w} × {h} · {count} layers',
  'gallery.card.metaItem_many': '{w} × {h} · {count} layers',
  'gallery.card.metaItem_other': '{w} × {h} · {count} layers',
  'gallery.card.metaStack_one': 'Stack · {count} artwork',
  'gallery.card.metaStack_few': 'Stack · {count} artworks',
  'gallery.card.metaStack_many': 'Stack · {count} artworks',
  'gallery.card.metaStack_other': 'Stack · {count} artworks',
  'gallery.trash.title': 'Recycle Bin',
  'gallery.trash.emptyBtn': 'Empty bin ({n})',
  'gallery.trash.bin': 'Bin',
  'gallery.trash.binCount': 'Bin ({n})',
  'gallery.bar.new': 'New',
  'gallery.bar.selected_one': '{count} selected',
  'gallery.bar.selected_few': '{count} selected',
  'gallery.bar.selected_many': '{count} selected',
  'gallery.bar.selected_other': '{count} selected',
  'gallery.bar.stack': 'Stack',
  'gallery.empty.noMatch': 'No artworks match your search',
  'gallery.empty.none': 'No artworks yet. Tap + New to start painting or Import a file.',
  'gallery.trash.purgeOne': 'Permanently delete "{name}"? This cannot be undone.',
  'gallery.trash.emptyTitle': 'Empty Recycle Bin',
  'gallery.trash.emptyOk': 'Empty bin',
  'gallery.trash.purgeMany_one': 'Permanently delete {count} artwork? This cannot be undone.',
  'gallery.trash.purgeMany_few': 'Permanently delete {count} artworks? This cannot be undone.',
  'gallery.trash.purgeMany_many': 'Permanently delete {count} artworks? This cannot be undone.',
  'gallery.trash.purgeMany_other': 'Permanently delete {count} artworks? This cannot be undone.',
  'gallery.sample.sunset': 'Sample: Sunset',
  'gallery.sample.color': 'Sample: Color study',
  'gallery.sample.grid': 'Sample: Sketch grid',
  'gallery.error.reopenFailed': 'Reopen failed: ',
  'gallery.recovered_few': 'Recovered {count} unsaved strokes',
  'gallery.recovered_many': 'Recovered {count} unsaved strokes',
  'gallery.imported': 'Imported',
  'gallery.recovered_one': 'Recovered {count} unsaved stroke',
  'gallery.recovered_other': 'Recovered {count} unsaved strokes',
}
export default dict
