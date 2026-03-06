/**
 * Example of SQL injection vulnerability.
 */
import java.sql.*;

public class SqlInjection {
    public static void getUser(String userId) throws SQLException {
        Connection conn = null;
        Statement stmt = null;
        ResultSet rs = null;
        
        try {
            // 安全漏洞：SQL注入
            String sql = "SELECT * FROM users WHERE id = " + userId;
            stmt = conn.createStatement();
            rs = stmt.executeQuery(sql);
            
            while (rs.next()) {
                System.out.println("User: " + rs.getString("name"));
            }
        } finally {
            if (rs != null) rs.close();
            if (stmt != null) stmt.close();
            if (conn != null) conn.close();
        }
    }
    
    public static void main(String[] args) throws SQLException {
        // 恶意输入示例: "1 OR 1=1"
        getUser(args[0]);
    }
}