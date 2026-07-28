//! 字节模式匹配

#[derive(Debug, Clone)]
pub enum PatternByte {
    Exact(u8),
    Wildcard,
    Mask { and: u8, eq: u8 },
}

pub fn match_pattern(data: &[u8], pattern: &[PatternByte]) -> bool {
    if data.len() != pattern.len() {
        return false;
    }
    data.iter().zip(pattern.iter()).all(|(d, p)| match p {
        PatternByte::Exact(expected) => d == expected,
        PatternByte::Wildcard => true,
        PatternByte::Mask { and, eq } => (d & and) == eq,
    })
}

pub fn parse_pattern(pattern_str: &str) -> Result<Vec<PatternByte>, String> {
    pattern_str
        .split_whitespace()
        .map(|s| {
            if s == "??" {
                Ok(PatternByte::Wildcard)
            } else if s.contains('/') {
                let parts: Vec<&str> = s.split('/').collect();
                if parts.len() == 2 {
                    let and = u8::from_str_radix(parts[0], 16).map_err(|e| e.to_string())?;
                    let eq = u8::from_str_radix(parts[1], 16).map_err(|e| e.to_string())?;
                    Ok(PatternByte::Mask { and, eq })
                } else {
                    Err(format!("无效的掩码格式: {}", s))
                }
            } else {
                let val = u8::from_str_radix(s, 16).map_err(|e| e.to_string())?;
                Ok(PatternByte::Exact(val))
            }
        })
        .collect()
}
