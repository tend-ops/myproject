def calculate_sum(numbers):
    """
    Calculate the sum of a list of numbers.
    """
    total = 0
    for number in numbers:
        total += number
    return total

if __name__ == "__main__":
    numbers = [1, 2, 3, 4, 5]
    result = calculate_sum(numbers)
    print(f"Sum: {result}")