use std::fmt;

pub type CliResult<T> = Result<T, Failure>;

#[derive(Debug)]
pub enum Failure {
    Usage(String),
    Execution(String),
    Conflict(String),
}

impl Failure {
    pub fn usage(message: impl Into<String>) -> Self {
        Self::Usage(message.into())
    }

    pub fn execution(message: impl Into<String>) -> Self {
        Self::Execution(message.into())
    }

    pub fn from_core(message: impl Into<String>) -> Self {
        let message = message.into();
        if is_conflict(&message) {
            Self::Conflict(message)
        } else {
            Self::Execution(message)
        }
    }

    pub fn code(&self) -> i32 {
        match self {
            Self::Usage(_) => 1,
            Self::Execution(_) => 2,
            Self::Conflict(_) => 3,
        }
    }

    pub fn message(&self) -> &str {
        match self {
            Self::Usage(message) | Self::Execution(message) | Self::Conflict(message) => message,
        }
    }
}

impl fmt::Display for Failure {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message())
    }
}

fn is_conflict(message: &str) -> bool {
    let lowered = message.to_lowercase();
    ["конфликт", "conflict", "изменил", "изменена"]
        .iter()
        .any(|marker| lowered.contains(*marker))
}

#[cfg(test)]
mod tests {
    use super::Failure;

    #[test]
    fn conflict_messages_get_the_conflict_exit_code() {
        for message in [
            "файл изменился на диске",
            "Идея.md: hash изменился после preview/read",
            "Заметка изменилась после чтения: hash не совпал — перечитайте её и повторите правку",
            "Идея.md изменена после транзакции; откат отменён целиком",
        ] {
            assert_eq!(Failure::from_core(message).code(), 3, "{message}");
        }
    }

    #[test]
    fn other_errors_stay_execution_failures() {
        assert_eq!(Failure::from_core("Заметка не найдена: Идея").code(), 2);
        assert_eq!(Failure::usage("нет аргумента").code(), 1);
    }
}
