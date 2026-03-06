// Java测试文件

public class TestAllLanguages {
    public static int calculateSum(int a, int b) {
        return a + b;
    }
    
    public static int processData(int[] data) {
        int total = 0;
        for (int i = 0; i < data.length; i++) {
            total += data[i];
        }
        return total;
    }
    
    public static void main(String[] args) {
        int x = 10;
        int y = 20;
        int result = calculateSum(x, y);
        System.out.println("Sum: " + result);
        
        int[] data = {1, 2, 3, 4, 5};
        int processedResult = processData(data);
        System.out.println("Processed result: " + processedResult);
    }
}