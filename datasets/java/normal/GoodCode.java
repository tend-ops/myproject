/**
 * Calculate the sum of an array of numbers.
 */
public class GoodCode {
    public static int calculateSum(int[] numbers) {
        int total = 0;
        for (int number : numbers) {
            total += number;
        }
        return total;
    }
    
    public static void main(String[] args) {
        int[] numbers = {1, 2, 3, 4, 5};
        int result = calculateSum(numbers);
        System.out.println("Sum: " + result);
    }
}