// interface module (ru).
const dict: Record<string, string> = {
  'interface.prefs.interface_theme': 'Тема интерфейса',

  'interface.prefs.right_hand_interface': 'Интерфейс для правши',

  'interface.prefs.moves_the_sidebar_to_the_right_side_of': 'Переносит боковую панель на правую сторону экрана',

  'interface.prefs.brush_cursor': 'Курсор кисти',

  'interface.prefs.outline_shown_at_the_pen_pointer': 'Контур в точке пера / указателя',

  'interface.prefs.dynamic_brush_scaling': 'Динамический масштаб кисти',

  'interface.prefs.keep_the_brush_the_same_size_on_screen': 'Сохранять размер кисти на экране при масштабировании',

  'interface.prefs.canvas_rotation_snapping': 'Привязка поворота холста',

  'interface.prefs.snap_to_0_90_180_270_degrees_while_rot': 'Привязка к 0/90/180/270° при повороте двумя пальцами',

  'interface.prefs.zoom_rotation_readout': 'Индикатор масштаба и поворота',

  'interface.prefs.tooltips': 'Подсказки',

  'interface.prefs.selection_mask_visibility': 'Видимость маски выделения',

  'interface.prefs.opacity_of_the_selection_overlay': 'Непрозрачность наложения выделения',

  'interface.prefs.mouse_wheel_zooms': 'Колесо мыши масштабирует',

  'interface.prefs.off_wheel_pans_ctrl_wheel_always_zooms': 'Выкл. — колесо прокручивает холст (Ctrl+колесо всегда масштабирует)',

  'interface.prefs.hold_ctrl_to_show_shortcuts': 'Показывать сочетания при удержании Ctrl',

  'interface.prefs.high_contrast': 'Высокая контрастность',

  'interface.prefs.larger_interface_text': 'Крупный текст интерфейса',

  'interface.prefs.reduce_motion': 'Уменьшить анимацию',

  'interface.prefs.disables_interface_animations': 'Отключает анимацию интерфейса',

  'interface.prefs.finger_pressure_source': 'Источник нажима пальца',

  'interface.prefs.used_when_the_screen_reports_no_touch': 'Используется, если экран не сообщает силу касания',

  'interface.prefs.reset_touch_curve': 'Сбросить кривую касаний',

  'interface.prefs.pressure_smoothing': 'Сглаживание нажима',

  'interface.prefs.low_pass_filter_on_pen_pressure': 'Фильтр низких частот для нажима пера',

  'interface.prefs.touch_smoothing': 'Сглаживание касаний',

  'interface.prefs.smooths_finger_strokes': 'Сглаживает мазки пальцем',

  'interface.prefs.global_streamline': 'Общая стабилизация (StreamLine)',

  'interface.prefs.override_every_brush_s_own_streamline': 'Заменяет значение StreamLine у каждой кисти',

  'interface.prefs.streamline_amount': 'Величина стабилизации',

  'interface.prefs.mouse_pressure': 'Нажим мыши',

  'interface.prefs.simulated_pressure_for_mouse_users': 'Имитация нажима для мыши',

  'interface.prefs.auto_calibrate_pen_pressure': 'Автокалибровка нажима пера',

  'interface.prefs.detects_drivers_that_never_reach_full': 'Находит драйверы, которые не достигают полного нажима, и масштабирует значения',

  'interface.prefs.reset_pressure_curve': 'Сбросить кривую нажима',

  'interface.prefs.draw_with_finger': 'Рисовать пальцем',

  'interface.prefs.off_fingers_only_navigate_disable_touc': 'Выкл. — пальцы только двигают и масштабируют холст (отключает касания при рисовании)',

  'interface.prefs.palm_rejection': 'Защита от касания ладонью',

  'interface.prefs.ignore_touches_while_a_pen_is_in_range': 'Игнорировать касания, пока перо рядом с экраном',

  'interface.prefs.touch_and_hold_delay': 'Задержка касания с удержанием',

  'interface.prefs.pen_hold_delay_0_off': 'Задержка удержания пера (0 — выкл.)',

  'interface.prefs.rapid_undo_delay': 'Задержка быстрой отмены',

  'interface.prefs.interval_between_repeated_undo_redo_wh': 'Интервал повтора отмены / возврата при удержании двух / трёх пальцев',

  'interface.prefs.tap_duration': 'Длительность касания',

  'interface.prefs.longest_finger_down_time_that_still_co': 'Максимальное время касания, которое ещё считается тапом',

  'interface.prefs.movement_tolerance': 'Допуск смещения',

  'interface.prefs.how_far_fingers_may_drift_during_a_tap': 'Насколько пальцы могут сместиться при тапе или удержании',

  'interface.prefs.two_three_finger_hold_time': 'Время удержания двумя / тремя пальцами',

  'interface.prefs.delay_before_a_held_multi_finger_tap_s': 'Задержка перед повтором при удержании нескольких пальцев',

  'interface.prefs.hold_smudge_eraser_to_quick_switch': 'Быстрое переключение удержанием «Размазывания» / «Ластика»',

  'interface.prefs.press_and_hold_the_tool_button_to_use': 'Удерживайте кнопку инструмента, чтобы временно включить его; отпустите — вернётся прежний (0 — выкл.)',

  'interface.prefs.reset_gestures_to_default': 'Сбросить жесты по умолчанию',

  'interface.prefs.barrel_button': 'Кнопка на корпусе пера',

  'interface.prefs.second_barrel_button': 'Вторая кнопка на корпусе',

  'interface.prefs.eraser_end_of_the_pen': 'Ластик на конце пера',

  'interface.prefs.show_brush_outline_while_hovering': 'Показывать контур кисти при наведении',

  'interface.prefs.uses_pen_proximity_events': 'Использует события приближения пера',

  'interface.prefs.hover_size_opacity': 'Размер / непрозрачность при наведении',

  'interface.prefs.hovering_pen_shift_move_sideways_brush': 'Перо над экраном: Shift + движение вбок — размер кисти, Ctrl+Shift + движение — непрозрачность',

  'interface.prefs.predict_stroke_tip': 'Предсказание конца мазка',

  'interface.prefs.shows_where_the_pen_is_heading_display': 'Показывает, куда движется перо (только на экране, не рисуется), чтобы снизить ощутимую задержку',

  'interface.prefs.right_button': 'Правая кнопка',

  'interface.prefs.middle_button': 'Средняя кнопка',

  'interface.prefs.modify_button_hold': 'Кнопка «Изменить» (удержание)',

  'interface.prefs.the_square_button_between_the_sliders': 'Квадратная кнопка между ползунками',

  'interface.prefs.brush_preview_cache': 'Кэш превью кистей',

  'interface.prefs.rendered_stroke_previews_used_in_the_b': 'Превью мазков в библиотеке кистей. Очистите, если они устарели.',

  'interface.prefs.graphics_device': 'Графическое устройство',

  'interface.prefs.max_texture_size': 'Макс. размер текстуры',

  'interface.prefs.second_window': 'Второе окно',

  'interface.prefs.shows_the_artwork_without_the_interfac': 'Показывает рисунок без интерфейса, например на проекторе или втором мониторе. Двойной щелчок — во весь экран.',

  'interface.prefs.reset_all_preferences': 'Сбросить все настройки',

  'interface.prefs.restores_every_setting_on_every_tab_sh': 'Возвращает все настройки на всех вкладках (включая сочетания клавиш)',

  'interface.prefs.appearance': 'Внешний вид',

  'interface.prefs.accessibility': 'Специальные возможности',

  'interface.prefs.pressure_curve': 'Кривая нажима',

  'interface.prefs.touch_pressure_curve': 'Кривая нажима для касаний',

  'interface.prefs.smoothing': 'Сглаживание',

  'interface.prefs.devices': 'Устройства',

  'interface.prefs.touch': 'Касания',

  'interface.prefs.delays': 'Задержки',

  'interface.prefs.advanced_gesture_settings': 'Расширенные настройки жестов',

  'interface.prefs.gesture_assignments': 'Назначение жестов',

  'interface.prefs.gesture_practice_pad': 'Площадка для проверки жестов',

  'interface.prefs.pen_buttons_windows_ink_wacom_huion_xp': 'Кнопки пера (Windows Ink / Wacom / Huion / XP-Pen / Surface)',

  'interface.prefs.mouse': 'Мышь',

  'interface.prefs.sidebar_modify_button': 'Кнопка «Изменить» на боковой панели',

  'interface.prefs.windows_tip': 'Совет для Windows',

  'interface.prefs.tablet_diagnostics': 'Диагностика планшета',

  'interface.prefs.brush_cache': 'Кэш кистей',

  'interface.prefs.rendering': 'Отрисовка',

  'interface.prefs.project_canvas': 'Проекция холста',

  'interface.prefs.reset': 'Сбросить',

  'interface.prefs.drag_points_to_shape_the_response_clic': 'Перетаскивайте точки, чтобы изменить отклик. Щелчок добавляет точку, двойной щелчок или правая кнопка по точке удаляет её. Оранжевая метка показывает текущий нажим пера.',

  'interface.prefs.draw_on_the_test_pad_with_your_pen_to': 'Рисуйте пером на тестовой площадке, чтобы почувствовать кривую.',

  'interface.prefs.applied_to_finger_strokes_devices_that': 'Применяется к мазкам пальцем (устройства с датчиком силы касания используют его, иначе — источник ниже).',

  'interface.prefs.buttons_are_read_from_the_pointer_even': 'Кнопки определяются по битовой маске «buttons» Pointer Events: корпус = 2, вторая кнопка = 4, ластик = 32. В диагностике планшета видно, что сообщает ваше перо. Действия с удержанием (пипетка, перемещение…) работают, пока кнопка нажата.',

  'interface.prefs.if_windows_shows_a_circle_when_you_hol': 'Если Windows показывает круг, когда перо неподвижно, отключите «Нажать и удерживать для щелчка правой кнопкой» в Параметры > Bluetooth и устройства > Перо и Windows Ink (или в панели драйвера планшета). WinCreative сам подавляет контекстное меню, но это кольцо рисует сама Windows.',

  'interface.prefs.assigning_a_key_that_is_already_used_m': 'Если клавиша уже занята, она переназначается на новое действие. Сочетания из одних модификаторов (например, Alt) подходят для действий с удержанием.',

  'interface.prefs.the_quickmenu_opens_with_the_quickmenu': 'QuickMenu открывается действием «QuickMenu»: нажмите Q или назначьте его на кнопку пера, касание с удержанием или жест на других вкладках. До 5 меню; центральная кнопка переключает их.',

  'interface.prefs.add_key': 'Добавить',

  'interface.prefs.reset_all_shortcuts': 'Сбросить все сочетания',

  'interface.prefs.remove_this_menu': 'Удалить это меню',

  'interface.prefs.add_quickmenu': 'Добавить QuickMenu',

  'interface.prefs.reset_quickmenus': 'Сбросить QuickMenu',

  'interface.prefs.clear_cache': 'Очистить кэш',

  'interface.prefs.reset_everything': 'Сбросить всё',

  'interface.prefs.done': 'Готово',

  'interface.prefs.dark': 'Тёмная',

  'interface.prefs.light': 'Светлая',

  'interface.prefs.contrast_outline': 'Контрастный контур',

  'interface.prefs.active_color_outline': 'Контур цвета кисти',

  'interface.prefs.none': 'Нет',

  'interface.prefs.constant': 'Постоянный',

  'interface.prefs.speed_based': 'По скорости',

  'interface.prefs.two_finger_tap': 'Касание двумя пальцами',

  'interface.prefs.three_finger_tap': 'Касание тремя пальцами',

  'interface.prefs.four_finger_tap': 'Касание четырьмя пальцами',

  'interface.prefs.two_finger_tap_and_hold_repeats': 'Касание двумя пальцами с удержанием (повтор)',

  'interface.prefs.three_finger_tap_and_hold_repeats': 'Касание тремя пальцами с удержанием (повтор)',

  'interface.prefs.three_finger_scrub': 'Потирание тремя пальцами',

  'interface.prefs.three_finger_swipe_down': 'Смахивание тремя пальцами вниз',

  'interface.prefs.quick_pinch': 'Быстрое сведение пальцев',

  'interface.prefs.touch_and_hold_finger': 'Касание с удержанием (палец)',

  'interface.prefs.touch_and_hold_pen_tip': 'Касание с удержанием (кончик пера)',

  'interface.prefs.erase': 'Стирать',

  'interface.prefs.ignore_paint': 'Игнорировать (рисовать)',

  'interface.prefs.none_paren': '(нет)',

  'interface.prefs.touch_the_pad_with_1_4_fingers': 'Коснитесь площадки 1–4 пальцами',

  'interface.prefs.filter_actions': 'Фильтр действий…',

  'interface.prefs.click_to_remove': 'Нажмите, чтобы удалить',

  'interface.prefs.press_keys': 'Нажмите клавиши… (Esc — отмена)',

  'interface.prefs.tab.interface': 'Интерфейс',
  'interface.prefs.tab.pressure': 'Нажим и сглаживание',
  'interface.prefs.tab.gestures': 'Касания и жесты',
  'interface.prefs.tab.pen': 'Перо и кнопки',
  'interface.prefs.tab.shortcuts': 'Сочетания клавиш',
  'interface.prefs.tab.quickmenu': 'QuickMenu',
  'interface.prefs.tab.diagnostics': 'Диагностика планшета',
  'interface.prefs.tab.advanced': 'Дополнительно',

  'interface.prefs.fmt.ms': '{n} мс',
  'interface.prefs.fmt.px': '{n} px',
  'interface.prefs.fmt.off': 'выкл.',

  'interface.prefs.quickmenu_n': 'QuickMenu {n}',

  'interface.prefs.slot_n': 'Ячейка {n}',

  'interface.prefs.cache_cleared': 'Кэш превью кистей очищен',

  'interface.prefs.reset_done': 'Настройки сброшены',

  'interface.prefs.language': 'Language / Язык',

  'interface.prefs.language_hint': 'Применяется сразу. «Как в системе» — язык Windows.',

  'interface.prefs.language_auto': 'Как в системе',

  'interface.prefs.title': 'Настройки',

  'interface.prefs.pad.tap_one': 'Касание {count} пальцем',
  'interface.prefs.pad.tap_other': 'Касание {count} пальцами',
  'interface.prefs.pad.tap_few': 'Касание {count} пальцами',
  'interface.prefs.pad.tap_many': 'Касание {count} пальцами',
  'interface.prefs.pad.hold_one': 'Удержание {count} пальцем ({phase})',
  'interface.prefs.pad.hold_other': 'Удержание {count} пальцами ({phase})',
  'interface.prefs.pad.hold_few': 'Удержание {count} пальцами ({phase})',
  'interface.prefs.pad.hold_many': 'Удержание {count} пальцами ({phase})',
  'interface.prefs.pad.scrub': 'потирание тремя пальцами',
  'interface.prefs.pad.swipeDown': 'смахивание тремя пальцами вниз',
  'interface.prefs.pad.longPress': 'касание с удержанием',
  'interface.prefs.pad.recognized': 'Распознано: {what}',

  'interface.cheat.title': 'Сочетания клавиш',

  'interface.cheat.hint': 'Изменить можно в меню «Действия» > «Настройки» > «Сочетания клавиш». Удерживайте Ctrl, чтобы показать этот список.',

  'interface.action.prefs': 'Настройки',

  'interface.action.diagnostics': 'Диагностика планшета',

  'interface.action.help': 'Справка',

  'interface.action.project': 'Проекция холста (второе окно)',

  'interface.action.cheatsheet': 'Шпаргалка по сочетаниям',

  'interface.action.quickMenu': 'QuickMenu',

  'interface.quickmenu.next': 'Следующее QuickMenu',

  'interface.menu.project': 'Проекция холста (второе окно)',

  'interface.menu.prefs': 'Настройки…',

  'interface.menu.pressure': 'Кривая нажима…',

  'interface.menu.gestures': 'Управление жестами…',

  'interface.menu.shortcuts': 'Сочетания клавиш…',

  'interface.menu.diagnostics': 'Диагностика планшета…',

  'interface.menu.cheatsheet': 'Шпаргалка по сочетаниям',

  'interface.menu.help': 'Справка',

  'interface.menu.whatsnew': 'Что нового',

  'interface.menu.about': 'О программе WinCreative',

  'interface.help.title': 'Справка',

  'interface.help.intro': 'WinCreative — приложение для рисования в духе Procreate. Всё описанное ниже можно изменить в меню «Действия» > «Настройки».',

  'interface.help.touchTitle': 'Жесты касаниями',

  'interface.help.touch1': 'Один палец рисует. Двумя пальцами можно масштабировать, вращать и двигать холст.',

  'interface.help.touch2': 'Касание двумя пальцами — отмена, тремя — повтор (удерживайте для повтора).',

  'interface.help.touch3': 'Потирание тремя пальцами очищает слой. Касание четырьмя пальцами скрывает интерфейс.',

  'interface.help.touch4': 'Касание с удержанием на холсте — пипетка. Быстрое сведение пальцев — вписать в экран.',

  'interface.help.penTitle': 'Перо',

  'interface.help.pen1': 'Нажим, наклон и вращение пера используются кистями, которые их поддерживают. Ластик на конце пера стирает.',

  'interface.help.pen2': 'Кнопка на корпусе по умолчанию — пипетка, вторая — QuickMenu. Назначить другое можно на вкладке «Перо и кнопки».',

  'interface.help.pen3': 'Нажим ощущается неверно? Измените кривую на вкладке «Нажим и сглаживание» и проверьте «Диагностику планшета».',

  'interface.help.kbTitle': 'Клавиатура',

  'interface.help.kb1': 'Удерживайте Ctrl или нажмите F1, чтобы увидеть все сочетания. Изменить их можно на вкладке «Сочетания клавиш».',

  'interface.help.kb2': 'Пробел + перетаскивание — перемещение, R + перетаскивание — поворот, I или Alt — выбор цвета, [ ] — размер кисти, Tab — скрыть интерфейс, Q — QuickMenu.',

  'interface.help.aboutText': 'WinCreative {version} — приложение для рисования для Windows в духе Procreate. Независимый проект, не связанный с Savage Interactive.',

  'interface.help.aboutLicense': 'Лицензия: {license}. Свободное ПО: его можно использовать, изучать, изменять и распространять на условиях лицензии.',

  'interface.help.aboutSource': 'Исходный код',

  'interface.help.aboutNotices': 'Сторонние компоненты: для экспорта видео используется встроенная сборка FFmpeg (GPL-3.0); см. THIRD_PARTY_NOTICES.md и папку licenses рядом с приложением.',

  'interface.help.aboutTablet': 'Поддержка планшетов работает через Windows Ink и Pointer Events: перья Wacom, Huion, XP-Pen и Surface передают нажим, наклон, вращение и кнопки.',

  'interface.help.new1': 'Полная поддержка пера: автокалибровка нажима, редактируемая кривая нажима, кнопки пера, курсор при наведении, диагностика планшета.',

  'interface.help.new2': 'Жесты: касания двумя/тремя/четырьмя пальцами, удержание для повтора, потирание, смахивание, быстрое сведение, пипетка по касанию с удержанием.',

  'interface.help.new3': 'QuickMenu, настраиваемые сочетания клавиш, шпаргалка по сочетаниям, светлая тема и интерфейс для правши.',

  'interface.projector.closed': 'Проекция закрыта',

  'interface.projector.failed': 'Не удалось открыть окно проекции',

  'interface.projector.windowTitle': 'WinCreative — проекция холста',

  'interface.projector.started': 'Холст выводится во втором окне (двойной щелчок по нему — во весь экран)',

  'interface.hidden': 'Интерфейс скрыт — нажмите Tab, чтобы вернуть',

  'interface.prefs.preset.linear': 'Линейная',
  'interface.prefs.preset.soft': 'Мягкая',
  'interface.prefs.preset.firm': 'Жёсткая',
  'interface.prefs.preset.s_curve': 'S-образная',
  'interface.prefs.preset.light_touch': 'Лёгкое касание',

  'interface.diag.resetCalibration': 'Сбросить калибровку и максимум',

  'interface.diag.instructions': 'Двигайте перо (или палец / мышь) над площадкой, наводите, нажимайте, наклоняйте, вращайте и нажимайте кнопки пера. Значения обновляются в реальном времени.',

  'interface.diag.pressure': 'Нажим',

  'interface.diag.clearPad': 'Очистить площадку',
  'interface.diag.cell.type': 'Тип указателя',
  'interface.diag.cell.pressure': 'Нажим (сырой)',
  'interface.diag.cell.cal': 'Нажим (откалиброванный)',
  'interface.diag.cell.curve': 'После кривой',
  'interface.diag.cell.tilt': 'Наклон X / Y (°)',
  'interface.diag.cell.az': 'Азимут (°)',
  'interface.diag.cell.alt': 'Высота (°)',
  'interface.diag.cell.twist': 'Вращение / корпус (°)',
  'interface.diag.cell.buttons': 'Маска кнопок',
  'interface.diag.cell.btnname': 'Кнопки',
  'interface.diag.cell.size': 'Контакт Ш × В',
  'interface.diag.cell.rate': 'Частота отчётов (Гц)',
  'interface.diag.cell.coal': 'Объединённые / предсказанные',
  'interface.diag.cell.state': 'Состояние',
  'interface.diag.cell.max': 'Макс. нажим',
  'interface.diag.cell.id': 'ID указателя',
  'interface.diag.testPad': 'Тестовая область: рисуйте пером',
  'interface.diag.state.idle': 'пока нет активности пера',
  'interface.diag.state.lifted': 'поднято',
  'interface.diag.state.contact': 'касание',
  'interface.diag.state.hover': 'над экраном',
  'interface.diag.state.out': 'вне зоны',
  'interface.diag.calActive': 'Автокалибровка включена: потолок драйвера {peak} приведён к 1,0 (масштаб ×{scale}).',
  'interface.diag.calNone': 'Автокалибровка: потолок драйвера не обнаружен (наибольшее плато {peak}). Включается, когда нажим пера регулярно не доходит до 1,0.',
  'interface.curve.penPressure': 'нажим пера',
  'interface.prefs.stopProjecting': 'Остановить показ',
  'interface.prefs.projectCanvas': 'Показать холст',
}
export default dict
