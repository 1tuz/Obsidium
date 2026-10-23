use crate::error::{CliResult, Failure};
use serde_json::Value;
use std::io::Read;

pub struct Args {
    items: Vec<String>,
}

impl Args {
    pub fn new(items: Vec<String>) -> Self {
        Self { items }
    }

    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }

    pub fn at(&self, index: usize) -> Option<&str> {
        self.items.get(index).map(String::as_str)
    }

    pub fn first(&self) -> Option<&str> {
        self.at(0)
    }

    pub fn value_at(&self, index: usize) -> Option<String> {
        self.at(index)
            .filter(|value| !value.starts_with("--"))
            .map(str::to_owned)
    }

    pub fn rest_from(&self, index: usize) -> String {
        self.items
            .get(index..)
            .unwrap_or_default()
            .join(" ")
            .trim()
            .to_owned()
    }

    pub fn reject_unknown_flags(&self, start: usize) -> CliResult<()> {
        match self
            .items
            .iter()
            .skip(start)
            .find(|item| item.starts_with("--"))
        {
            Some(flag) => Err(Failure::usage(format!(
                "неизвестный флаг: {flag}. Список флагов: obsidium help"
            ))),
            None => Ok(()),
        }
    }

    pub fn take_flag(&mut self, name: &str) -> bool {
        let Some(index) = self.items.iter().position(|item| item == name) else {
            return false;
        };
        self.items.remove(index);
        true
    }

    pub fn take_option(&mut self, name: &str) -> CliResult<Option<String>> {
        let prefix = format!("{name}=");
        if let Some(index) = self.items.iter().position(|item| item.starts_with(&prefix)) {
            let item = self.items.remove(index);
            return Ok(Some(item[prefix.len()..].to_owned()));
        }
        let Some(index) = self.items.iter().position(|item| item == name) else {
            return Ok(None);
        };
        if index + 1 >= self.items.len() {
            return Err(Failure::usage(format!("флагу {name} нужно значение")));
        }
        self.items.remove(index);
        Ok(Some(self.items.remove(index)))
    }

    pub fn take_number(&mut self, name: &str) -> CliResult<Option<usize>> {
        let Some(raw) = self.take_option(name)? else {
            return Ok(None);
        };
        raw.parse::<usize>()
            .map(Some)
            .map_err(|_| Failure::usage(format!("{name}: ожидается целое число, получено «{raw}»")))
    }

    pub fn take_list(&mut self, name: &str) -> CliResult<Option<Vec<String>>> {
        let Some(raw) = self.take_option(name)? else {
            return Ok(None);
        };
        let items = raw
            .split(',')
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>();
        if items.is_empty() {
            return Err(Failure::usage(format!("{name}: пустой список")));
        }
        Ok(Some(items))
    }

    pub fn content(&mut self, stdin: bool) -> CliResult<Option<String>> {
        if stdin {
            return read_stdin().map(Some);
        }
        self.take_option("--content")
    }

    pub fn payload(&mut self, stdin: bool) -> CliResult<Value> {
        let raw = if stdin {
            read_stdin()?
        } else if let Some(file) = self.take_option("--file")? {
            std::fs::read_to_string(&file).map_err(|error| {
                Failure::usage(format!("не удалось прочитать план {file}: {error}"))
            })?
        } else {
            return Err(Failure::usage(
                "передайте план JSON через --file PATH или --stdin",
            ));
        };
        let value = serde_json::from_str::<Value>(&raw)
            .map_err(|error| Failure::usage(format!("неверный JSON плана: {error}")))?;
        if !value.is_object() {
            return Err(Failure::usage("план должен быть JSON-объектом"));
        }
        Ok(value)
    }
}

pub fn read_stdin() -> CliResult<String> {
    let mut content = String::new();
    std::io::stdin()
        .read_to_string(&mut content)
        .map_err(|error| Failure::execution(format!("не удалось прочитать stdin: {error}")))?;
    Ok(content)
}

pub fn required(args: &Args, index: usize, usage: &str) -> CliResult<String> {
    args.at(index)
        .map(str::to_owned)
        .ok_or_else(|| Failure::usage(usage))
}

#[cfg(test)]
mod tests {
    use super::Args;

    fn args(items: &[&str]) -> Args {
        Args::new(items.iter().map(|item| (*item).to_owned()).collect())
    }

    #[test]
    fn flags_are_removed_wherever_they_stand() {
        let mut parsed = args(&["note", "read", "--limit", "5", "Заметка"]);
        assert_eq!(parsed.take_number("--limit").unwrap(), Some(5));
        assert_eq!(parsed.at(2), Some("Заметка"));
        assert_eq!(parsed.take_number("--offset").unwrap(), None);
    }

    #[test]
    fn an_option_can_carry_its_value_after_an_equals_sign() {
        let mut parsed = args(&["search", "--folder=Проекты", "идея"]);
        assert_eq!(
            parsed.take_option("--folder").unwrap().as_deref(),
            Some("Проекты")
        );
        assert_eq!(parsed.rest_from(1), "идея");
    }

    #[test]
    fn a_flag_without_a_value_is_a_usage_error() {
        let mut parsed = args(&["note", "read", "--limit"]);
        assert_eq!(parsed.take_number("--limit").unwrap_err().code(), 1);
    }

    #[test]
    fn a_sections_list_is_split_and_trimmed() {
        let mut parsed = args(&["note", "context", "--sections", "outline, tasks"]);
        assert_eq!(
            parsed.take_list("--sections").unwrap(),
            Some(vec!["outline".to_owned(), "tasks".to_owned()])
        );
    }

    #[test]
    fn a_positional_value_never_starts_with_a_dash() {
        let parsed = args(&["transaction", "rollback", "--file"]);
        assert_eq!(parsed.value_at(2), None);
        assert_eq!(parsed.at(2), Some("--file"));
    }
}
