//! 正则文本匹配与捕获组提取

use regex::Regex;

pub struct RegexMatcher {
    pattern: String,
    compiled: Option<Regex>,
}

impl RegexMatcher {
    pub fn new(pattern: &str) -> Self {
        let compiled = Regex::new(pattern).ok();
        Self {
            pattern: pattern.to_string(),
            compiled,
        }
    }

    pub fn is_match(&self, text: &str) -> bool {
        self.compiled.as_ref().map_or(false, |re| re.is_match(text))
    }

    pub fn captures(&self, text: &str) -> Vec<(String, String)> {
        self.compiled.as_ref().and_then(|re| {
            re.captures(text).map(|caps| {
                caps.iter().enumerate()
                    .filter_map(|(i, m)| {
                        m.map(|m| {
                            let name = re.capture_names()
                                .nth(i)
                                .unwrap_or("")
                                .to_string();
                            (name, m.as_str().to_string())
                        })
                    })
                    .collect()
            })
        }).unwrap_or_default()
    }
}
