import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../providers/app_provider.dart';
import '../services/data_service.dart';
import '../utils/date_utils.dart' as date_utils;
import '../utils/format_utils.dart';

class ShiftDetailScreen extends StatefulWidget {
  final String shiftId;

  const ShiftDetailScreen({super.key, required this.shiftId});

  @override
  State<ShiftDetailScreen> createState() => _ShiftDetailScreenState();
}

class _ShiftDetailScreenState extends State<ShiftDetailScreen> {
  @override
  Widget build(BuildContext context) {
    final appProvider = Provider.of<AppProvider>(context);
    final dataService = appProvider.dataService;
    final shift = dataService.getShiftById(widget.shiftId);
    final isAdmin = appProvider.isAdmin;
    final currentUser = appProvider.currentUser;

    if (shift == null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Смена')),
        body: const Center(child: Text('Смена не найдена')),
      );
    }

    final employee = shift.actualEmployeeId != null
        ? dataService.getEmployeeById(shift.actualEmployeeId!)
        : null;
    final canEdit = isAdmin || (appProvider.isJunior && shift.actualEmployeeId == currentUser?.id);

    return Scaffold(
      appBar: AppBar(
        title: Text(
          '${date_utils.DateUtils.formatWeekday(shift.date)} ${date_utils.DateUtils.formatDate(shift.date)} · ${date_utils.DateUtils.formatSlot(shift.slot)}',
        ),
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Shift info
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Сотрудник: ${employee?.name ?? "Не назначен"}',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 8),
                    Text('Часы: ${FormatUtils.formatHours(shift.hours)}'),
                    Text('Тип: ${date_utils.DateUtils.formatShiftType(shift.shiftType)}'),
                    if (shift.note != null && shift.note!.isNotEmpty)
                      Text('Примечание: ${shift.note}'),
                    if (isAdmin) ...[
                      const SizedBox(height: 16),
                      ElevatedButton(
                        onPressed: () => _editShift(context, shift, dataService, appProvider),
                        child: const Text('Редактировать'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            // Cleaning block
            _CleaningBlock(
              shift: shift,
              dataService: dataService,
              appProvider: appProvider,
              canMarkCleaning: canEdit && shift.actualEmployeeId == currentUser?.id,
            ),
            const SizedBox(height: 16),
            // Extra classes block
            _ExtraClassesBlock(
              shift: shift,
              dataService: dataService,
              appProvider: appProvider,
              canAddExtraClass: canEdit && shift.actualEmployeeId == currentUser?.id,
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _editShift(
    BuildContext context,
    Shift shift,
    DataService dataService,
    AppProvider appProvider,
  ) async {
    final navigator = Navigator.of(context);
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => _EditShiftDialog(shift: shift, dataService: dataService),
    );

    if (result != null && mounted) {
      final updatedShift = Shift(
        id: shift.id,
        weekId: shift.weekId,
        locationId: shift.locationId,
        date: shift.date,
        slot: shift.slot,
        shiftType: result['shiftType'] as String? ?? shift.shiftType,
        hours: (result['hours'] as num?)?.toDouble() ?? shift.hours,
        cleaningPlanned: shift.cleaningPlanned,
        cleaningConfirmed: shift.cleaningConfirmed,
        plannedEmployeeId: shift.plannedEmployeeId,
        actualEmployeeId: result['actualEmployeeId'] as String? ?? shift.actualEmployeeId,
        cleaningRecordId: shift.cleaningRecordId,
        note: result['note'] as String? ?? shift.note,
      );
      dataService.updateShift(updatedShift);
      appProvider.refresh();
      navigator.pop();
      navigator.pop();
      navigator.push(
        MaterialPageRoute(
          builder: (_) => ShiftDetailScreen(shiftId: shift.id),
        ),
      );
    }
  }
}

class _EditShiftDialog extends StatefulWidget {
  final Shift shift;
  final DataService dataService;

  const _EditShiftDialog({required this.shift, required this.dataService});

  @override
  State<_EditShiftDialog> createState() => _EditShiftDialogState();
}

class _EditShiftDialogState extends State<_EditShiftDialog> {
  late String _shiftType;
  late double _hours;
  String? _actualEmployeeId;
  String? _note;

  @override
  void initState() {
    super.initState();
    _shiftType = widget.shift.shiftType;
    _hours = widget.shift.hours;
    _actualEmployeeId = widget.shift.actualEmployeeId;
    _note = widget.shift.note;
  }

  @override
  Widget build(BuildContext context) {
    final employees = widget.dataService.getEmployeesByLocation(widget.shift.locationId);

    return AlertDialog(
      title: const Text('Редактировать смену'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            DropdownButtonFormField<String>(
              initialValue: _actualEmployeeId,
              decoration: const InputDecoration(labelText: 'Сотрудник'),
              items: [
                const DropdownMenuItem(value: null, child: Text('Не назначен')),
                ...employees.map((e) => DropdownMenuItem(
                      value: e.id,
                      child: Text(e.name),
                    )),
              ],
              onChanged: (value) => setState(() => _actualEmployeeId = value),
            ),
            TextFormField(
              initialValue: _hours.toString(),
              decoration: const InputDecoration(labelText: 'Часы'),
              keyboardType: TextInputType.number,
              onChanged: (value) {
                _hours = double.tryParse(value) ?? _hours;
              },
            ),
            DropdownButtonFormField<String>(
              initialValue: _shiftType,
              decoration: const InputDecoration(labelText: 'Тип смены'),
              items: const [
                DropdownMenuItem(value: 'normal', child: Text('Обычная')),
                DropdownMenuItem(value: 'replacement', child: Text('Замена')),
                DropdownMenuItem(value: 'training', child: Text('Обучение')),
              ],
              onChanged: (value) => setState(() => _shiftType = value ?? 'normal'),
            ),
            TextFormField(
              initialValue: _note,
              decoration: const InputDecoration(labelText: 'Примечание'),
              maxLines: 2,
              onChanged: (value) => _note = value.isEmpty ? null : value,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        ElevatedButton(
          onPressed: () {
            Navigator.of(context).pop({
              'actualEmployeeId': _actualEmployeeId,
              'hours': _hours,
              'shiftType': _shiftType,
              'note': _note,
            });
          },
          child: const Text('Сохранить'),
        ),
      ],
    );
  }
}

class _CleaningBlock extends StatelessWidget {
  final Shift shift;
  final DataService dataService;
  final AppProvider appProvider;
  final bool canMarkCleaning;

  const _CleaningBlock({
    required this.shift,
    required this.dataService,
    required this.appProvider,
    required this.canMarkCleaning,
  });

  @override
  Widget build(BuildContext context) {
    final cleaningRule = dataService.getCleaningRuleForLocation(shift.locationId);
    final cleaningRecord = shift.cleaningRecordId != null
        ? dataService.getCleaningRecordById(shift.cleaningRecordId!)
        : null;
    final performedBy = cleaningRecord != null
        ? dataService.getEmployeeById(cleaningRecord.performedByEmployeeId)
        : null;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Уборка',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            Text('По плану: ${shift.cleaningPlanned ? "Да" : "Нет"}'),
            Text(
              cleaningRecord != null
                  ? 'Отмечено: ${performedBy?.name ?? "Неизвестно"}'
                  : 'Не отмечено',
            ),
            if (cleaningRecord != null && cleaningRecord.flagged)
              const Text(
                '⚠️ Уборка не по плану',
                style: TextStyle(color: Colors.orange),
              ),
            const SizedBox(height: 16),
            if (canMarkCleaning)
              ElevatedButton.icon(
                onPressed: () => _markCleaning(context),
                icon: const Icon(Icons.cleaning_services),
                label: const Text('Я сделал(а) уборку'),
              ),
            if (appProvider.isAdmin)
              ElevatedButton.icon(
                onPressed: () => _markCleaningByOther(context),
                icon: const Icon(Icons.people),
                label: const Text('Уборку сделал другой'),
              ),
          ],
        ),
      ),
    );
  }

  void _markCleaning(BuildContext context) async {
    final shouldFlag = !shift.cleaningPlanned;

    if (shouldFlag) {
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Подтверждение'),
          content: const Text(
            'Сегодня уборка не запланирована. Уверен(а)?',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Отмена'),
            ),
            ElevatedButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Да'),
            ),
          ],
        ),
      );

      if (confirmed != true) return;
    }

    final cleaningRecord = dataService.createCleaningRecord(
      locationId: shift.locationId,
      dateFor: shift.date,
      performedByEmployeeId: appProvider.currentUser!.id,
      flagged: shouldFlag,
    );

    final updatedShift = Shift(
      id: shift.id,
      weekId: shift.weekId,
      locationId: shift.locationId,
      date: shift.date,
      slot: shift.slot,
      shiftType: shift.shiftType,
      hours: shift.hours,
      cleaningPlanned: shift.cleaningPlanned,
      cleaningConfirmed: true,
      plannedEmployeeId: shift.plannedEmployeeId,
      actualEmployeeId: shift.actualEmployeeId,
      cleaningRecordId: cleaningRecord.id,
      note: shift.note,
    );

    dataService.updateShift(updatedShift);
    appProvider.refresh();
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Уборка отмечена')),
      );
    }
  }

  void _markCleaningByOther(BuildContext context) async {
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      builder: (context) => _CleaningByOtherSheet(
        shift: shift,
        dataService: dataService,
      ),
    );

    if (result != null) {
      final selectedDate = result['date'] as String;
      final selectedEmployeeId = result['employeeId'] as String;
      
      final dateObj = DateTime.parse(selectedDate);
      final weekday = dateObj.weekday;
      final cleaningRule =
          dataService.getCleaningRuleForLocation(shift.locationId);
      final shouldFlag = !cleaningRule.daysOfWeek.contains(weekday);

      if (shouldFlag) {
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Подтверждение'),
            content: const Text('Уборка не запланирована на этот день. Продолжить?'),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Отмена'),
              ),
              ElevatedButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Да'),
              ),
            ],
          ),
        );

        if (confirmed != true) return;
      }

      final cleaningRecord = dataService.createCleaningRecord(
        locationId: shift.locationId,
        dateFor: selectedDate,
        performedByEmployeeId: selectedEmployeeId,
        flagged: shouldFlag,
      );

      if (selectedDate == shift.date && shift.slot == 'evening' && shift.cleaningPlanned) {
        final updatedShift = Shift(
          id: shift.id,
          weekId: shift.weekId,
          locationId: shift.locationId,
          date: shift.date,
          slot: shift.slot,
          shiftType: shift.shiftType,
          hours: shift.hours,
          cleaningPlanned: shift.cleaningPlanned,
          cleaningConfirmed: true,
          plannedEmployeeId: shift.plannedEmployeeId,
          actualEmployeeId: shift.actualEmployeeId,
          cleaningRecordId: cleaningRecord.id,
          note: shift.note,
        );
        dataService.updateShift(updatedShift);
      }

      appProvider.refresh();
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Уборка отмечена')),
        );
      }
    }
  }
}

class _CleaningByOtherSheet extends StatefulWidget {
  final Shift shift;
  final DataService dataService;

  const _CleaningByOtherSheet({
    required this.shift,
    required this.dataService,
  });

  @override
  State<_CleaningByOtherSheet> createState() => _CleaningByOtherSheetState();
}

class _CleaningByOtherSheetState extends State<_CleaningByOtherSheet> {
  late String _selectedDate;
  String? _selectedEmployeeId;

  @override
  void initState() {
    super.initState();
    _selectedDate = widget.shift.date;
    final week = widget.dataService.getWeekById(widget.shift.weekId);
    if (week == null) {
      _selectedDate = widget.shift.date;
    }
  }

  @override
  Widget build(BuildContext context) {
    final week = widget.dataService.getWeekById(widget.shift.weekId);
    final dates = week != null
        ? date_utils.DateUtils.getWeekDates(week.startDate)
        : [widget.shift.date];
    final employees = widget.dataService.getJuniorEmployees(widget.shift.locationId);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Уборку сделал другой', style: TextStyle(fontSize: 18)),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: _selectedDate,
            decoration: const InputDecoration(labelText: 'За какой день уборка?'),
            items: dates.map((date) {
              final week = widget.dataService.getWeekById(widget.shift.weekId);
              final datesList = week != null
                  ? date_utils.DateUtils.getWeekDates(week.startDate)
                  : [widget.shift.date];
              return DropdownMenuItem(
                value: date,
                child: Text('${date_utils.DateUtils.formatDate(date)} (${date_utils.DateUtils.formatWeekday(date)})'),
              );
            }).toList(),
            onChanged: (value) => setState(() => _selectedDate = value ?? widget.shift.date),
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: _selectedEmployeeId,
            decoration: const InputDecoration(labelText: 'Кто сделал?'),
            items: employees.map((e) => DropdownMenuItem(
                  value: e.id,
                  child: Text(e.name),
                )).toList(),
            onChanged: (value) => setState(() => _selectedEmployeeId = value),
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _selectedEmployeeId != null
                ? () => Navigator.of(context).pop({
                      'date': _selectedDate,
                      'employeeId': _selectedEmployeeId,
                    })
                : null,
            child: const Text('Сохранить'),
          ),
        ],
      ),
    );
  }
}

class _ExtraClassesBlock extends StatelessWidget {
  final Shift shift;
  final DataService dataService;
  final AppProvider appProvider;
  final bool canAddExtraClass;

  const _ExtraClassesBlock({
    required this.shift,
    required this.dataService,
    required this.appProvider,
    required this.canAddExtraClass,
  });

  @override
  Widget build(BuildContext context) {
    final extraRecords = dataService.getExtraClassRecordsByShift(shift.id);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Доп. занятия (оплата за ребёнка)',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            if (extraRecords.isEmpty)
              const Text('Нет записей')
            else
              ...extraRecords.map((record) {
                final type = dataService.getExtraClassTypeById(record.extraClassTypeId);
                return ListTile(
                  title: Text('${type?.name ?? "Неизвестно"} — ${record.childrenCount} детей'),
                  subtitle: Text(
                    '${FormatUtils.formatCurrency(record.amount)}${record.flagged ? " ⚠️" : ""}',
                  ),
                  trailing: record.flagged
                      ? const Icon(Icons.warning, color: Colors.orange)
                      : null,
                );
              }),
            if (canAddExtraClass)
              ElevatedButton.icon(
                onPressed: () => _addExtraClass(context),
                icon: const Icon(Icons.add),
                label: const Text('Провёл(а) доп. занятие'),
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _addExtraClass(BuildContext context) async {
    final messenger = ScaffoldMessenger.of(context);
    final result = await showModalBottomSheet<Map<String, dynamic>>(
      context: context,
      builder: (context) => _AddExtraClassSheet(
        shift: shift,
        dataService: dataService,
      ),
    );

    if (result != null) {
      final extraClassTypeId = result['extraClassTypeId'] as String;
      final childrenCount = result['childrenCount'] as int;
      final type = dataService.getExtraClassTypeById(extraClassTypeId);
      if (type == null) return;

      final expected = shift.slot == 'evening'; // MVP rule
      final shouldFlag = !expected;

      if (shouldFlag) {
        if (!context.mounted) return;
        final confirmed = await showDialog<bool>(
          context: context,
          builder: (context) => AlertDialog(
            title: const Text('Подтверждение'),
            content: const Text(
              'По расписанию такого занятия может не быть. Уверен(а)?',
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.of(context).pop(false),
                child: const Text('Отмена'),
              ),
              ElevatedButton(
                onPressed: () => Navigator.of(context).pop(true),
                child: const Text('Да'),
              ),
            ],
          ),
        );

        if (confirmed != true) return;
      }

      dataService.createExtraClassRecord(
        locationId: shift.locationId,
        shiftId: shift.id,
        date: shift.date,
        employeeId: appProvider.currentUser!.id,
        extraClassTypeId: extraClassTypeId,
        childrenCount: childrenCount,
        ratePerChildSnapshot: type.ratePerChild,
        flagged: shouldFlag,
      );

      appProvider.refresh();
      messenger.showSnackBar(
        const SnackBar(content: Text('Доп. занятие добавлено')),
      );
    }
  }
}

class _AddExtraClassSheet extends StatefulWidget {
  final Shift shift;
  final DataService dataService;

  const _AddExtraClassSheet({
    required this.shift,
    required this.dataService,
  });

  @override
  State<_AddExtraClassSheet> createState() => _AddExtraClassSheetState();
}

class _AddExtraClassSheetState extends State<_AddExtraClassSheet> {
  String? _selectedTypeId;
  final _childrenController = TextEditingController();

  @override
  void dispose() {
    _childrenController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final types = widget.dataService.getActiveExtraClassTypes(widget.shift.locationId);

    return Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          const Text('Провёл(а) доп. занятие', style: TextStyle(fontSize: 18)),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: _selectedTypeId,
            decoration: const InputDecoration(labelText: 'Занятие'),
            items: types.map((t) => DropdownMenuItem(
                  value: t.id,
                  child: Text('${t.name} (${t.ratePerChild} ₽/ребёнок)'),
                )).toList(),
            onChanged: (value) => setState(() => _selectedTypeId = value),
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _childrenController,
            decoration: const InputDecoration(
              labelText: 'Число детей',
            ),
            keyboardType: TextInputType.number,
          ),
          const SizedBox(height: 24),
          ElevatedButton(
            onPressed: _selectedTypeId != null &&
                    _childrenController.text.isNotEmpty &&
                    int.tryParse(_childrenController.text) != null
                ? () {
                    Navigator.of(context).pop({
                      'extraClassTypeId': _selectedTypeId,
                      'childrenCount': int.parse(_childrenController.text),
                    });
                  }
                : null,
            child: const Text('Сохранить'),
          ),
        ],
      ),
    );
  }
}
