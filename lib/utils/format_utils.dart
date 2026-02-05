import 'package:intl/intl.dart';

class FormatUtils {
  static String formatCurrency(int amount) {
    return NumberFormat.currency(
      locale: 'ru_RU',
      symbol: '₽',
      decimalDigits: 0,
    ).format(amount);
  }

  static String formatHours(double hours) {
    return hours.toStringAsFixed(1).replaceAll('.0', '');
  }
}
