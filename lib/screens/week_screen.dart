import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../providers/app_provider.dart';
import '../services/data_service.dart';
import '../utils/date_utils.dart' as date_utils;
import '../utils/format_utils.dart';
import 'shift_detail_screen.dart';

class WeekScreen extends StatelessWidget {
  const WeekScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final appProvider = Provider.of<AppProvider>(context);
    final isAdmin = appProvider.isAdmin;
    final currentUser = appProvider.currentUser;
    final locationId = appProvider.selectedLocationId;

    if (locationId == null || currentUser == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    final dataService = appProvider.dataService;
    final week = dataService.getCurrentWeek() ?? dataService.getWeeks().first;
    final shifts = dataService.getShiftsByWeek(week.id);

    if (isAdmin) {
      return _AdminWeekView(
        week: week,
        shifts: shifts,
        dataService: dataService,
        locationId: locationId,
      );
    } else {
      return _JuniorWeekView(
        week: week,
        shifts: shifts.where((s) => s.actualEmployeeId == currentUser.id).toList(),
        dataService: dataService,
        currentUser: currentUser,
      );
    }
  }
}

class _AdminWeekView extends StatelessWidget {
  final Week week;
  final List<Shift> shifts;
  final DataService dataService;
  final String locationId;

  const _AdminWeekView({
    required this.week,
    required this.shifts,
    required this.dataService,
    required this.locationId,
  });

  @override
  Widget build(BuildContext context) {
    final dates = date_utils.DateUtils.getWeekDates(week.startDate);
    final slots = ['morning', 'evening'];

    return Scaffold(
      appBar: AppBar(
        title: const Text('Неделя'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.of(context).pushNamed('/settings'),
          ),
          IconButton(
            icon: const Icon(Icons.account_balance_wallet),
            onPressed: () => Navigator.of(context).pushNamed('/payroll'),
          ),
        ],
      ),
      body: SingleChildScrollView(
        child: Column(
          children: [
            // Week header
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: Text(
                '${date_utils.DateUtils.formatDate(dates.first)} - ${date_utils.DateUtils.formatDate(dates.last)}',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            // Grid
            Padding(
              padding: const EdgeInsets.all(8.0),
              child: Table(
                border: TableBorder.all(color: Colors.grey.shade300),
                children: [
                  // Header row
                  TableRow(
                    decoration: BoxDecoration(color: Colors.grey.shade200),
                    children: [
                      const TableCell(child: SizedBox.shrink()),
                      ...dates.map((date) => TableCell(
                            child: Padding(
                              padding: const EdgeInsets.all(8.0),
                              child: Center(
                                child: Text(
                                  date_utils.DateUtils.formatWeekday(date),
                                  style: const TextStyle(fontWeight: FontWeight.bold),
                                ),
                              ),
                            ),
                          )),
                    ],
                  ),
                  // Slot rows
                  ...slots.map((slot) => TableRow(
                        children: [
                          TableCell(
                            verticalAlignment: TableCellVerticalAlignment.middle,
                            child: Padding(
                              padding: const EdgeInsets.all(8.0),
                              child: Text(
                                date_utils.DateUtils.formatSlot(slot),
                                style: const TextStyle(fontWeight: FontWeight.bold),
                              ),
                            ),
                          ),
                          ...dates.map((date) {
                            final shift = shifts.firstWhere(
                              (s) => s.date == date && s.slot == slot,
                              orElse: () => Shift(
                                id: '',
                                weekId: week.id,
                                locationId: locationId,
                                date: date,
                                slot: slot,
                                shiftType: 'normal',
                                hours: 0,
                                cleaningPlanned: false,
                                cleaningConfirmed: false,
                              ),
                            );
                            return TableCell(
                              child: _ShiftCell(
                                shift: shift,
                                dataService: dataService,
                                onTap: () {
                                  Navigator.of(context).push(
                                    MaterialPageRoute(
                                      builder: (_) => ShiftDetailScreen(shiftId: shift.id),
                                    ),
                                  );
                                },
                              ),
                            );
                          }),
                        ],
                      )),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _JuniorWeekView extends StatelessWidget {
  final Week week;
  final List<Shift> shifts;
  final DataService dataService;
  final Employee currentUser;

  const _JuniorWeekView({
    required this.week,
    required this.shifts,
    required this.dataService,
    required this.currentUser,
  });

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Моя неделя'),
        actions: [
          IconButton(
            icon: const Icon(Icons.account_balance_wallet),
            onPressed: () => Navigator.of(context).pushNamed('/payroll'),
          ),
        ],
      ),
      body: shifts.isEmpty
          ? const Center(child: Text('Нет смен на эту неделю'))
          : ListView.builder(
              itemCount: shifts.length,
              itemBuilder: (context, index) {
                final shift = shifts[index];
                final employee = dataService.getEmployeeById(shift.actualEmployeeId ?? '');
                final cleaningRecords = dataService.getCleaningRecordsByShift(shift.id);
                final extraRecords = dataService.getExtraClassRecordsByShift(shift.id);

                return Card(
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: ListTile(
                    title: Text(
                      '${date_utils.DateUtils.formatDate(shift.date)} · ${date_utils.DateUtils.formatSlot(shift.slot)}',
                    ),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('${employee?.name ?? '—'} · ${FormatUtils.formatHours(shift.hours)} ч'),
                        if (shift.cleaningPlanned)
                          Row(
                            children: [
                              Icon(
                                shift.cleaningConfirmed ? Icons.check_circle : Icons.warning,
                                size: 16,
                                color: shift.cleaningConfirmed ? Colors.green : Colors.orange,
                              ),
                              const SizedBox(width: 4),
                              Text(
                                shift.cleaningConfirmed
                                    ? 'Уборка отмечена${cleaningRecords.isNotEmpty ? ' (${cleaningRecords.length})' : ''}'
                                    : 'Уборка не отмечена',
                                style: TextStyle(
                                  fontSize: 12,
                                  color: shift.cleaningConfirmed ? Colors.green : Colors.orange,
                                ),
                              ),
                            ],
                          ),
                        if (extraRecords.isNotEmpty)
                          Text(
                            'Доп. занятия: ${extraRecords.length}',
                            style: const TextStyle(fontSize: 12),
                          ),
                      ],
                    ),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => ShiftDetailScreen(shiftId: shift.id),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
    );
  }
}

class _ShiftCell extends StatelessWidget {
  final Shift shift;
  final DataService dataService;
  final VoidCallback onTap;

  const _ShiftCell({
    required this.shift,
    required this.dataService,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    if (shift.id.isEmpty) {
      return const SizedBox.shrink();
    }

    final employee = shift.actualEmployeeId != null
        ? dataService.getEmployeeById(shift.actualEmployeeId!)
        : null;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.all(4.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (employee != null)
              Text(
                employee.name,
                style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            Text(
              '${FormatUtils.formatHours(shift.hours)}ч',
              style: const TextStyle(fontSize: 9),
            ),
            Wrap(
              spacing: 2,
              children: [
                if (shift.cleaningPlanned)
                  Icon(
                    shift.cleaningConfirmed ? Icons.check_circle : Icons.warning,
                    size: 12,
                    color: shift.cleaningConfirmed ? Colors.green : Colors.orange,
                  ),
                if (shift.shiftType == 'replacement')
                  const Icon(Icons.swap_horiz, size: 12, color: Colors.blue),
                if (shift.shiftType == 'training')
                  const Icon(Icons.school, size: 12, color: Colors.purple),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

extension DataServiceExtension on DataService {
  List<CleaningRecord> getCleaningRecordsByShift(String shiftId) {
    final shift = getShiftById(shiftId);
    if (shift == null) return [];
    return getCleaningRecords()
        .where((c) => c.dateFor == shift.date)
        .toList();
  }
}
