import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../providers/app_provider.dart';
import '../services/data_service.dart';
import '../utils/format_utils.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  static const _weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  static const _roleLabels = {
    'junior': 'Младший',
    'senior': 'Старший',
    'admin': 'Администратор',
  };

  @override
  Widget build(BuildContext context) {
    final appProvider = Provider.of<AppProvider>(context);
    final dataService = appProvider.dataService;
    final locationId = appProvider.selectedLocationId;

    if (locationId == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final employees = dataService.getEmployeesByLocation(locationId);
    final rule = dataService.getCleaningRuleForLocation(locationId);
    final extraTypes =
        dataService.getExtraClassTypesByLocation(locationId);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Настройки'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _sectionTitle('Сотрудники'),
          const SizedBox(height: 8),
          ...employees.map((emp) => Card(
                child: ListTile(
                  title: Text(emp.name),
                  subtitle: Text(
                    '${_roleLabels[emp.role] ?? emp.role} · '
                    '${emp.ratePerHour} ₽/час'
                    '${emp.minHoursPerWeek != null ? " · мин. ${emp.minHoursPerWeek} ч/нед" : ""}',
                  ),
                  trailing: const Icon(Icons.edit),
                  onTap: () => _editEmployee(context, emp, dataService, appProvider),
                ),
              )),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => _addEmployee(context, locationId, dataService, appProvider),
            icon: const Icon(Icons.add),
            label: const Text('Добавить сотрудника'),
          ),
          const SizedBox(height: 24),
          _sectionTitle('Правило уборки'),
          const SizedBox(height: 8),
          Builder(
            builder: (context) {
              final days = rule.daysOfWeek.map((d) => _weekdayLabels[d - 1]).join(', ');
              return Card(
                child: ListTile(
                  title: Text('Дни: $days'),
                  subtitle: Text(
                    'Слот: ${rule.appliesToSlot == 'evening' ? "Вечер" : "Утро"} · '
                    'Ставка: ${FormatUtils.formatCurrency(rule.cleaningRate)}',
                  ),
                  trailing: const Icon(Icons.edit),
                  onTap: () => _editCleaningRule(
                      context, locationId, rule, dataService, appProvider),
                ),
              );
            },
          ),
          const SizedBox(height: 24),
          _sectionTitle('Доп. занятия'),
          const SizedBox(height: 8),
          ...extraTypes.map(
            (type) => Card(
              child: ListTile(
                title: Text(type.name),
                subtitle: Text(
                  '${FormatUtils.formatCurrency(type.ratePerChild)} за ребёнка · '
                  '${type.active ? "Активно" : "Неактивно"}',
                ),
                trailing: const Icon(Icons.edit),
                onTap: () => _editExtraType(
                    context, type, dataService, appProvider),
              ),
            ),
          ),
          const SizedBox(height: 8),
          OutlinedButton.icon(
            onPressed: () => _addExtraType(
                context, locationId, dataService, appProvider),
            icon: const Icon(Icons.add),
            label: const Text('Добавить вид занятия'),
          ),
          const SizedBox(height: 24),
          _sectionTitle('Часы по умолчанию'),
          const SizedBox(height: 8),
          _DefaultHoursCard(
            dataService: dataService,
            appProvider: appProvider,
          ),
        ],
      ),
    );
  }

  Widget _sectionTitle(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 18,
        fontWeight: FontWeight.bold,
      ),
    );
  }

  Future<void> _editEmployee(
    BuildContext context,
    Employee emp,
    DataService dataService,
    AppProvider appProvider,
  ) async {
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => _EmployeeDialog(
        name: emp.name,
        role: emp.role,
        ratePerHour: emp.ratePerHour,
        minHoursPerWeek: emp.minHoursPerWeek,
      ),
    );
    if (result != null && context.mounted) {
      final updated = Employee(
        id: emp.id,
        name: result['name'] as String,
        role: result['role'] as String,
        locationId: emp.locationId,
        ratePerHour: result['ratePerHour'] as int,
        minHoursPerWeek: result['minHoursPerWeek'] as int?,
      );
      dataService.updateEmployee(updated);
      appProvider.refresh();
      setState(() {});
    }
  }

  Future<void> _addEmployee(
    BuildContext context,
    String locationId,
    DataService dataService,
    AppProvider appProvider,
  ) async {
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => const _EmployeeDialog(),
    );
    if (result != null && context.mounted) {
      dataService.createEmployee(
        name: result['name'] as String,
        role: result['role'] as String,
        locationId: locationId,
        ratePerHour: result['ratePerHour'] as int,
        minHoursPerWeek: result['minHoursPerWeek'] as int?,
      );
      appProvider.refresh();
      setState(() {});
    }
  }

  Future<void> _editCleaningRule(
    BuildContext context,
    String locationId,
    CleaningRule rule,
    DataService dataService,
    AppProvider appProvider,
  ) async {
    final result = await showDialog<CleaningRule?>(
      context: context,
      builder: (context) => _CleaningRuleDialog(rule: rule),
    );
    if (result != null && context.mounted) {
      final withLocation = CleaningRule(
        locationId: locationId,
        daysOfWeek: result.daysOfWeek,
        appliesToSlot: result.appliesToSlot,
        cleaningRate: result.cleaningRate,
      );
      dataService.updateCleaningRule(withLocation);
      appProvider.refresh();
      setState(() {});
    }
  }

  Future<void> _editExtraType(
    BuildContext context,
    ExtraClassType type,
    DataService dataService,
    AppProvider appProvider,
  ) async {
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => _ExtraTypeDialog(
        name: type.name,
        ratePerChild: type.ratePerChild,
        active: type.active,
      ),
    );
    if (result != null && context.mounted) {
      final updated = ExtraClassType(
        id: type.id,
        locationId: type.locationId,
        name: result['name'] as String,
        ratePerChild: result['ratePerChild'] as int,
        active: result['active'] as bool,
      );
      dataService.updateExtraClassType(updated);
      appProvider.refresh();
      setState(() {});
    }
  }

  Future<void> _addExtraType(
    BuildContext context,
    String locationId,
    DataService dataService,
    AppProvider appProvider,
  ) async {
    final result = await showDialog<Map<String, dynamic>>(
      context: context,
      builder: (context) => const _ExtraTypeDialog(),
    );
    if (result != null && context.mounted) {
      dataService.createExtraClassType(
        locationId: locationId,
        name: result['name'] as String,
        ratePerChild: result['ratePerChild'] as int,
        active: result['active'] as bool,
      );
      appProvider.refresh();
      setState(() {});
    }
  }
}

class _EmployeeDialog extends StatefulWidget {
  final String? name;
  final String? role;
  final int? ratePerHour;
  final int? minHoursPerWeek;

  const _EmployeeDialog({
    this.name,
    this.role,
    this.ratePerHour,
    this.minHoursPerWeek,
  });

  @override
  State<_EmployeeDialog> createState() => _EmployeeDialogState();
}

class _EmployeeDialogState extends State<_EmployeeDialog> {
  late TextEditingController _nameController;
  late String _role;
  late TextEditingController _rateController;
  late TextEditingController _minHoursController;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.name ?? '');
    _role = widget.role ?? 'junior';
    _rateController = TextEditingController(
      text: (widget.ratePerHour ?? 280).toString(),
    );
    _minHoursController = TextEditingController(
      text: widget.minHoursPerWeek?.toString() ?? '',
    );
  }

  @override
  void dispose() {
    _nameController.dispose();
    _rateController.dispose();
    _minHoursController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.name == null ? 'Новый сотрудник' : 'Редактировать'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Имя',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            DropdownButtonFormField<String>(
              initialValue: _role,
              decoration: const InputDecoration(
                labelText: 'Должность',
                border: OutlineInputBorder(),
              ),
              items: _SettingsScreenState._roleLabels.entries
                  .map((e) => DropdownMenuItem(
                        value: e.key,
                        child: Text(e.value),
                      ))
                  .toList(),
              onChanged: (v) => setState(() => _role = v ?? 'junior'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _rateController,
              decoration: const InputDecoration(
                labelText: 'Ставка (₽/час)',
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _minHoursController,
              decoration: const InputDecoration(
                labelText: 'Мин. часов в неделю (необязательно)',
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.number,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () {
            final name = _nameController.text.trim();
            final rate = int.tryParse(_rateController.text);
            final minH = _minHoursController.text.trim().isEmpty
                ? null
                : int.tryParse(_minHoursController.text);
            if (name.isEmpty || rate == null || rate < 0) return;
            Navigator.of(context).pop({
              'name': name,
              'role': _role,
              'ratePerHour': rate,
              'minHoursPerWeek': minH,
            });
          },
          child: const Text('Сохранить'),
        ),
      ],
    );
  }
}

class _CleaningRuleDialog extends StatefulWidget {
  final CleaningRule rule;

  const _CleaningRuleDialog({required this.rule});

  @override
  State<_CleaningRuleDialog> createState() => _CleaningRuleDialogState();
}

class _CleaningRuleDialogState extends State<_CleaningRuleDialog> {
  late List<int> _days;
  late String _slot;
  late TextEditingController _rateController;

  @override
  void initState() {
    super.initState();
    _days = List.from(widget.rule.daysOfWeek)..sort();
    _slot = widget.rule.appliesToSlot;
    _rateController = TextEditingController(
      text: widget.rule.cleaningRate.toString(),
    );
  }

  @override
  void dispose() {
    _rateController.dispose();
    super.dispose();
  }

  void _toggleDay(int day) {
    setState(() {
      if (_days.contains(day)) {
        _days.remove(day);
      } else {
        _days.add(day);
        _days.sort();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Правило уборки'),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Дни недели:', style: TextStyle(fontWeight: FontWeight.w500)),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: List.generate(7, (i) {
                final day = i + 1;
                final selected = _days.contains(day);
                return FilterChip(
                  label: Text(_SettingsScreenState._weekdayLabels[i]),
                  selected: selected,
                  onSelected: (_) => _toggleDay(day),
                );
              }),
            ),
            const SizedBox(height: 16),
            DropdownButtonFormField<String>(
              initialValue: _slot,
              decoration: const InputDecoration(
                labelText: 'Слот',
                border: OutlineInputBorder(),
              ),
              items: const [
                DropdownMenuItem(value: 'morning', child: Text('Утро')),
                DropdownMenuItem(value: 'evening', child: Text('Вечер')),
              ],
              onChanged: (v) => setState(() => _slot = v ?? 'evening'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _rateController,
              decoration: const InputDecoration(
                labelText: 'Ставка за уборку (₽)',
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.number,
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () {
            final rate = int.tryParse(_rateController.text);
            if (_days.isEmpty || rate == null || rate < 0) return;
            Navigator.of(context).pop(CleaningRule(
              locationId: widget.rule.locationId,
              daysOfWeek: _days,
              appliesToSlot: _slot,
              cleaningRate: rate,
            ));
          },
          child: const Text('Сохранить'),
        ),
      ],
    );
  }
}

class _ExtraTypeDialog extends StatefulWidget {
  final String? name;
  final int? ratePerChild;
  final bool? active;

  const _ExtraTypeDialog({
    this.name,
    this.ratePerChild,
    this.active,
  });

  @override
  State<_ExtraTypeDialog> createState() => _ExtraTypeDialogState();
}

class _ExtraTypeDialogState extends State<_ExtraTypeDialog> {
  late TextEditingController _nameController;
  late TextEditingController _rateController;
  late bool _active;

  @override
  void initState() {
    super.initState();
    _nameController = TextEditingController(text: widget.name ?? '');
    _rateController = TextEditingController(
      text: (widget.ratePerChild ?? 200).toString(),
    );
    _active = widget.active ?? true;
  }

  @override
  void dispose() {
    _nameController.dispose();
    _rateController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(
        widget.name == null ? 'Новый вид занятия' : 'Редактировать занятие',
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Название',
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _rateController,
              decoration: const InputDecoration(
                labelText: 'Ставка за ребёнка (₽)',
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.number,
            ),
            const SizedBox(height: 12),
            SwitchListTile(
              title: const Text('Активно'),
              value: _active,
              onChanged: (v) => setState(() => _active = v),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Отмена'),
        ),
        FilledButton(
          onPressed: () {
            final name = _nameController.text.trim();
            final rate = int.tryParse(_rateController.text);
            if (name.isEmpty || rate == null || rate < 0) return;
            Navigator.of(context).pop({
              'name': name,
              'ratePerChild': rate,
              'active': _active,
            });
          },
          child: const Text('Сохранить'),
        ),
      ],
    );
  }
}

class _DefaultHoursCard extends StatefulWidget {
  final DataService dataService;
  final AppProvider appProvider;

  const _DefaultHoursCard({
    required this.dataService,
    required this.appProvider,
  });

  @override
  State<_DefaultHoursCard> createState() => _DefaultHoursCardState();
}

class _DefaultHoursCardState extends State<_DefaultHoursCard> {
  late TextEditingController _morningController;
  late TextEditingController _eveningController;

  @override
  void initState() {
    super.initState();
    _morningController = TextEditingController(
      text: widget.dataService.getDefaultHours('morning').toString(),
    );
    _eveningController = TextEditingController(
      text: widget.dataService.getDefaultHours('evening').toString(),
    );
  }

  @override
  void dispose() {
    _morningController.dispose();
    _eveningController.dispose();
    super.dispose();
  }

  void _save() {
    final morning = double.tryParse(_morningController.text);
    final evening = double.tryParse(_eveningController.text);
    if (morning != null && morning >= 0.5 && morning <= 24) {
      widget.dataService.setDefaultHours('morning', morning);
    }
    if (evening != null && evening >= 0.5 && evening <= 24) {
      widget.dataService.setDefaultHours('evening', evening);
    }
    widget.appProvider.refresh();
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Общее количество часов по умолчанию для смены',
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _morningController,
                    decoration: const InputDecoration(
                      labelText: 'Утро (ч)',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onSubmitted: (_) => _save(),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: TextField(
                    controller: _eveningController,
                    decoration: const InputDecoration(
                      labelText: 'Вечер (ч)',
                      border: OutlineInputBorder(),
                    ),
                    keyboardType: const TextInputType.numberWithOptions(
                      decimal: true,
                    ),
                    onSubmitted: (_) => _save(),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: _save,
              child: const Text('Сохранить часы'),
            ),
          ],
        ),
      ),
    );
  }
}
