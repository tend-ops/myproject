/**
 * Calculate the sum of an array of numbers with bad naming.
 */
public class BadNaming {
    public static int calculate_sum(int[] nums) { // 不符合驼峰命名法
        int total = 0;
        for (int i = 0; i < nums.length; i++) { // 不清晰的变量名
            total += nums[i];
        }
        return total;
    }
    
    public static void main(String[] args) {
        int[] arr = {1, 2, 3, 4, 5}; // 不清晰的变量名
        int res = calculate_sum(arr); // 不符合驼峰命名法
        System.out.println("Sum: " + res);
    }
}