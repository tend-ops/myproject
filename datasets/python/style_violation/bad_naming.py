def calculate_sum(numbers):
    total = 0
    for i in numbers:  # 不清晰的变量名
        total += i
    return total

def main():
    nums = [1, 2, 3, 4, 5]  # 不清晰的变量名
    res = calculate_sum(nums)
    print(f"Sum: {res}")

if __name__ == "__main__":
    main()