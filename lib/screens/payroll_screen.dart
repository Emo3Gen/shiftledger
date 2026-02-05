import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import '../models/models.dart';
import '../providers/app_provider.dart';
import '../services/data_service.dart';
import '../utils/format_utils.dart';
import '../utils/date_utils.dart' as date_utils;

class PayrollScreen extends StatelessWidget {
  const PayrollScreen({super.key});

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

    if (isAdmin) {
      return _AdminPayrollView(
        week: week,
        dataService: dataService,
        locationId: locationId,
      );
    } else {
      return _JuniorPayrollView(
        week: week,
        dataService: dataService,
        employee: currentUser,
      );
    }
  }
}

class _AdminPayrollView extends StatelessWidget {
  final Week week;
  final DataService dataService;
  final String locationId;

  const _AdminPayrollView({
    required this.week,
    required this.dataService,
    required this.locationId,
  });

  @override
  Widget build(BuildContext context) {
    final employees = dataService.getJuniorEmployees(locationId);
    final payrolls = employees.map((emp) {
      final calc = dataService.calculatePayroll(emp.id, week.id);
      return {'employee': emp, ...calc};
    }).toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('Зарплата'),
        actions: [
          IconButton(
            icon: const Icon(Icons.download),
            onPressed: () => _exportToCsv(context, payrolls),
            tooltip: 'Экспорт в CSV',
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Text(
              'Неделя: ${date_utils.DateUtils.formatDate(week.startDate.toString().substring(0, 10))} - ${date_utils.DateUtils.formatDate(week.startDate.add(const Duration(days: 6)).toString().substring(0, 10))}',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          Expanded(
            child: ListView.builder(
              itemCount: payrolls.length,
              itemBuilder: (context, index) {
                final payroll = payrolls[index];
                final employee = payroll['employee'] as Employee;
                final baseHours = payroll['baseHours'] as double;
                final basePay = payroll['basePay'] as int;
                final cleaningPay = payroll['cleaningPay'] as int;
                final extraPay = payroll['extraPay'] as int;
                final total = payroll['total'] as int;

                return Card(
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  child: ListTile(
                    title: Text(employee.name),
                    subtitle: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('Часы: ${FormatUtils.formatHours(baseHours)}'),
                        Text('Базовая: ${FormatUtils.formatCurrency(basePay)}'),
                        Text('Уборки: ${FormatUtils.formatCurrency(cleaningPay)}'),
                        Text('Доп. занятия: ${FormatUtils.formatCurrency(extraPay)}'),
                      ],
                    ),
                    trailing: Text(
                      FormatUtils.formatCurrency(total),
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
                    ),
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(
                          builder: (_) => PayrollDetailScreen(
                            employee: employee,
                            week: week,
                            payroll: payroll,
                            dataService: dataService,
                          ),
                        ),
                      );
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  void _exportToCsv(BuildContext context, List<Map<String, dynamic>> payrolls) {
    final buffer = StringBuffer();
    buffer.writeln('Сотрудник,Часы,Базовая,Уборки,Доп.занятия,Итого');
    
    for (final payroll in payrolls) {
      final employee = payroll['employee'] as Employee;
      final baseHours = payroll['baseHours'] as double;
      final basePay = payroll['basePay'] as int;
      final cleaningPay = payroll['cleaningPay'] as int;
      final extraPay = payroll['extraPay'] as int;
      final total = payroll['total'] as int;
      
      buffer.writeln(
        '${employee.name},${FormatUtils.formatHours(baseHours)},$basePay,$cleaningPay,$extraPay,$total',
      );
    }

    // In web, we can copy to clipboard or download
    // For MVP, just show in dialog
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('CSV данные'),
        content: SingleChildScrollView(
          child: Text(buffer.toString()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Закрыть'),
          ),
        ],
      ),
    );
  }
}

class _JuniorPayrollView extends StatelessWidget {
  final Week week;
  final DataService dataService;
  final Employee employee;

  const _JuniorPayrollView({
    required this.week,
    required this.dataService,
    required this.employee,
  });

  @override
  Widget build(BuildContext context) {
    final payroll = dataService.calculatePayroll(employee.id, week.id);
    final baseHours = payroll['baseHours'] as double;
    final basePay = payroll['basePay'] as int;
    final cleaningPay = payroll['cleaningPay'] as int;
    final extraPay = payroll['extraPay'] as int;
    final total = payroll['total'] as int;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Моя зарплата'),
      ),
      body: Column(
        children: [
          Card(
            margin: const EdgeInsets.all(16),
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                children: [
                  Text(
                    'Итого: ${FormatUtils.formatCurrency(total)}',
                    style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                          fontWeight: FontWeight.bold,
                        ),
                  ),
                  const SizedBox(height: 16),
                  _PayrollRow('Часы', FormatUtils.formatHours(baseHours)),
                  _PayrollRow('Базовая оплата', FormatUtils.formatCurrency(basePay)),
                  _PayrollRow('Уборки', FormatUtils.formatCurrency(cleaningPay)),
                  _PayrollRow('Доп. занятия', FormatUtils.formatCurrency(extraPay)),
                ],
              ),
            ),
          ),
          Expanded(
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                ElevatedButton(
                  onPressed: () {
                    Navigator.of(context).push(
                      MaterialPageRoute(
                        builder: (_) => PayrollDetailScreen(
                          employee: employee,
                          week: week,
                          payroll: payroll,
                          dataService: dataService,
                        ),
                      ),
                    );
                  },
                  child: const Text('Детализация'),
                ),
                const SizedBox(height: 16),
                ElevatedButton.icon(
                  onPressed: () => _showAIExplanation(context, payroll),
                  icon: const Icon(Icons.help_outline),
                  label: const Text('Почему так?'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  void _showAIExplanation(BuildContext context, Map<String, dynamic> payroll) {
    final baseHours = payroll['baseHours'] as double;
    final basePay = payroll['basePay'] as int;
    final cleaningPay = payroll['cleaningPay'] as int;
    final extraPay = payroll['extraPay'] as int;
    final cleaningRecords = payroll['cleaningRecords'] as List<CleaningRecord>;
    final extraRecords = payroll['extraRecords'] as List<ExtraClassRecord>;

    final explanation = StringBuffer();
    explanation.writeln('Расчёт зарплаты за неделю:\n');
    explanation.writeln('1. Базовая оплата:');
    explanation.writeln('   - Отработано часов: ${FormatUtils.formatHours(baseHours)}');
    explanation.writeln('   - Ставка: ${employee.ratePerHour} ₽/час');
    explanation.writeln('   - Итого: ${FormatUtils.formatCurrency(basePay)}\n');
    
    if (cleaningPay > 0) {
      explanation.writeln('2. Уборки:');
      explanation.writeln('   - Количество: ${cleaningRecords.length}');
      explanation.writeln(
          '   - Ставка: ${dataService.getCleaningRuleForLocation(employee.locationId).cleaningRate} ₽');
      explanation.writeln('   - Итого: ${FormatUtils.formatCurrency(cleaningPay)}\n');
    }
    
    if (extraPay > 0) {
      explanation.writeln('3. Доп. занятия:');
      for (final record in extraRecords) {
        final type = dataService.getExtraClassTypeById(record.extraClassTypeId);
        explanation.writeln('   - ${type?.name ?? "Неизвестно"}: ${record.childrenCount} детей × ${record.ratePerChildSnapshot} ₽ = ${FormatUtils.formatCurrency(record.amount)}');
      }
      explanation.writeln('   - Итого: ${FormatUtils.formatCurrency(extraPay)}\n');
    }
    
    explanation.writeln('Общая сумма: ${FormatUtils.formatCurrency(basePay + cleaningPay + extraPay)}');

    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Объяснение расчёта'),
        content: SingleChildScrollView(
          child: Text(explanation.toString()),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Закрыть'),
          ),
        ],
      ),
    );
  }
}

class _PayrollRow extends StatelessWidget {
  final String label;
  final String value;

  const _PayrollRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label),
          Text(value, style: const TextStyle(fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }
}

class PayrollDetailScreen extends StatelessWidget {
  final Employee employee;
  final Week week;
  final Map<String, dynamic> payroll;
  final DataService dataService;

  const PayrollDetailScreen({
    super.key,
    required this.employee,
    required this.week,
    required this.payroll,
    required this.dataService,
  });

  @override
  Widget build(BuildContext context) {
    final shifts = payroll['shifts'] as List<Shift>;
    final cleaningRecords = payroll['cleaningRecords'] as List<CleaningRecord>;
    final extraRecords = payroll['extraRecords'] as List<ExtraClassRecord>;

    return Scaffold(
      appBar: AppBar(
        title: Text('Детализация: ${employee.name}'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Text('Смены', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          ...shifts.map((shift) => Card(
                child: ListTile(
                  title: Text(
                    '${date_utils.DateUtils.formatDate(shift.date)} · ${date_utils.DateUtils.formatSlot(shift.slot)}',
                  ),
                  subtitle: Text('${FormatUtils.formatHours(shift.hours)} ч'),
                  trailing: Text(
                    FormatUtils.formatCurrency(
                      (shift.hours * employee.ratePerHour).round(),
                    ),
                  ),
                ),
              )),
          const SizedBox(height: 16),
          const Text('Уборки', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          if (cleaningRecords.isEmpty)
            const Text('Нет записей')
          else
            ...cleaningRecords.map((record) => Card(
                  child: ListTile(
                    title: Text(date_utils.DateUtils.formatDate(record.dateFor)),
                    trailing: record.flagged
                        ? const Icon(Icons.warning, color: Colors.orange)
                        : null,
                  ),
                )),
          const SizedBox(height: 16),
          const Text('Доп. занятия', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          if (extraRecords.isEmpty)
            const Text('Нет записей')
          else
            ...extraRecords.map((record) {
              final type = dataService.getExtraClassTypeById(record.extraClassTypeId);
              return Card(
                child: ListTile(
                  title: Text('${type?.name ?? "Неизвестно"} — ${record.childrenCount} детей'),
                  subtitle: Text(date_utils.DateUtils.formatDate(record.date)),
                  trailing: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(FormatUtils.formatCurrency(record.amount)),
                      if (record.flagged)
                        const Icon(Icons.warning, color: Colors.orange, size: 16),
                    ],
                  ),
                ),
              );
            }),
        ],
      ),
    );
  }
}
